// @vitest-environment node
// A static import fails collection while src/pages/set-workspace/model.ts is absent.
import type { ProblemKind } from '@hydrooj/common';
import type { ObjectiveClientQuestion } from '../../src/components/objective-answer-panel.tsx';
import { describe, expect, it } from 'vitest';

// Deadline text is compared as Shanghai civil time, matching formatMoment.
process.env.TZ = 'Asia/Shanghai';

const modelLoaders = import.meta.glob('../../src/pages/set-workspace/model.ts');
const MODEL_SOURCE = 'src/pages/set-workspace/model.ts';

const TID = '64b8000000000000000000a1';
const HOMEWORK_OVERVIEW = `/homework/${TID}`;
const PAPER_OVERVIEW = `/paper/${TID}`;
const CONTEST_OVERVIEW = `/contest/${TID}`;
const NOW_ISO = '2026-10-18T14:00:00+08:00';
const NOW = Date.parse(NOW_ISO);

const SECTIONS = ['overview', 'problems', 'records', 'ranking', 'notice', 'clar', 'print'] as const;
const KINDS = ['true_false', 'single', 'multi', 'blank', 'program_fill', 'function', 'programming', 'subjective'] as const;
const PHASES = ['upcoming', 'ready', 'answering', 'submitted', 'ended'] as const;
const WORKSPACE_KINDS = ['homework', 'paper', 'contest'] as const;
const FLAVORS = ['homework', 'paper', 'acm', 'ioi', 'oi'] as const;
const MODES = ['browser', 'client', 'preview'] as const;
const NUMBERINGS = ['pta', 'letter'] as const;
const CELL_STATES = ['empty', 'draft', 'submitted', 'correct', 'wrong', 'partial'] as const;
const LOCK_REASONS = ['not_started', 'not_open', 'need_start', 'need_attend', 'client_only', 'view_closed'] as const;
const CONTEST_FLAVORS = ['acm', 'ioi', 'oi'] as const;

type SectionName = (typeof SECTIONS)[number];
type CellState = (typeof CELL_STATES)[number];
type WsKind = (typeof WORKSPACE_KINDS)[number];
type WsFlavor = (typeof FLAVORS)[number];
type WsPhase = (typeof PHASES)[number];
type WsMode = (typeof MODES)[number];
type ProgramKind = 'program_fill' | 'function' | 'programming';

interface WsItem {
  pid: number;
  label: string;
  title: string;
  kind: ProblemKind;
  score: number;
  state: CellState;
  submits: number;
  lastScore: number | null;
}

interface WsGroup {
  kind: ProblemKind;
  no: number | null;
  name: string;
  scoreEach: number | null;
  items: WsItem[];
}

interface WsInfoRow {
  label: string;
  text?: string;
  at?: string;
  range?: [string, string];
}

interface WsAnnouncement {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
}

interface WsReply {
  content: string;
  createdAt: string;
}

interface WsClarification {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
  replies: WsReply[];
}

interface WsWindow {
  beginAt: string;
  endAt: string;
  dueAt: string | null;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
  lockAt: string | null;
}

interface WsTotals {
  problemCount: number;
  maxScore: number | null;
  answered: number;
  score: number | null;
  accepted: number | null;
  showScore: boolean;
}

interface WsPaper {
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

interface WsAction {
  canStart: boolean;
  canFinalize: boolean;
  canAttend: boolean;
  canUnrank: boolean;
  canSubmit: boolean;
  attended: boolean;
  canRetake: boolean;
}

interface WsUrls {
  back: string | null;
  manage: string | null;
  overview: string;
  problem: string | null;
  submit: string | null;
  submitCode: string | null;
  recordDetail: string;
  records: string;
  ranking: string | null;
  clarify: string | null;
  print: string | null;
  start: string | null;
  attend: string | null;
  draftList: string | null;
  draftUpsert: string | null;
  submitKind: string | null;
  lockKind: string | null;
  finalize: string | null;
  virtual: string | null;
  verifyObjective: string | null;
  verifySubmit: string | null;
  practice: string | null;
  teamProblem: string | null;
  pretest: string | null;
}

interface SetWorkspace {
  kind: WsKind;
  flavor: WsFlavor;
  tid: string;
  title: string;
  description: string;
  mode: WsMode;
  phase: WsPhase;
  locked: { reason: (typeof LOCK_REASONS)[number] } | null;
  numbering: 'pta' | 'letter';
  window: WsWindow;
  groups: WsGroup[];
  totals: WsTotals;
  verdictVisible: boolean;
  objectiveVerdictVisible: boolean;
  team: { teamName: string; role: 'captain' | 'member' } | null;
  paper: WsPaper | null;
  announcements: WsAnnouncement[];
  clarifications: WsClarification[];
  info: WsInfoRow[];
  student: { name: string; studentId: string | null };
  action: WsAction;
  urls: WsUrls;
}

interface WorkspaceProblem {
  title: string;
  content: string;
  questions: ObjectiveClientQuestion[] | null;
  programKind: ProgramKind | null;
  raw: Record<string, unknown>;
}

interface SectionQuery {
  section: SectionName;
  kind: ProblemKind | null;
  q: number | null;
}

interface SectionExtra {
  kind?: ProblemKind;
  q?: number;
}

interface RailItem {
  section: SectionName;
  label: string;
  icon: string;
}

interface WsDraft {
  answers: Record<string, string | string[]> | null;
  submittedAnswers: Record<string, string | string[]> | null;
}

type DraftMap = ReadonlyMap<number, WsDraft>;

interface TimerView {
  label: '剩余' | '个人剩余' | '距开始' | '距开考' | '截止';
  endAt: number | null;
  text: string | null;
  tone: 'fg' | 'warning' | 'danger';
}

interface OpenTarget {
  kind: ProblemKind;
  q: number | null;
}

interface WorkspaceModel {
  parseSetWorkspace: (raw: unknown) => SetWorkspace;
  parseWorkspaceProblems: (raw: unknown) => Map<number, WorkspaceProblem>;
  readSection: (search: string) => SectionQuery;
  sectionHref: (ws: SetWorkspace, section: SectionName, extra?: SectionExtra) => string;
  railItems: (ws: SetWorkspace) => RailItem[];
  cellClass: (state: CellState, flagged: boolean, current: boolean) => string;
  pendingKinds: (ws: SetWorkspace, drafts: DraftMap) => ProblemKind[];
  pendingCount: (group: WsGroup, drafts: DraftMap) => number;
  timerView: (ws: SetWorkspace, now: number) => TimerView | null;
  firstOpenTarget: (ws: SetWorkspace) => OpenTarget | null;
}

const QUESTIONS: ObjectiveClientQuestion[] = [
  {
    key: '1',
    kind: 'single',
    score: 5,
    prompt: '下列哪个是栈？',
    choices: ['队列', '栈'],
    presentation: 'truefalse',
  },
  { key: '2', kind: 'blank', score: 3 },
];

const ANNOUNCEMENT: WsAnnouncement = {
  id: 'a1',
  subject: '更正',
  content: '选项 B 的表述已更正。',
  createdAt: '2026-10-18T14:40:00+08:00',
};

const CLARIFICATION: WsClarification = {
  id: 'c1',
  subject: '取整',
  content: '是否向下取整？',
  createdAt: '2026-10-18T14:35:00+08:00',
  replies: [{ content: '是的，向下取整。', createdAt: '2026-10-18T14:37:00+08:00' }],
};

const PAPER_FACTS: WsPaper = {
  score: 86,
  passed: true,
  judging: false,
  passScore: 60,
  attemptLimit: 2,
  attemptsUsed: 1,
  canRetake: true,
  submitByKind: true,
  lockedKinds: ['single'],
};

const RAIL = {
  overview: { section: 'overview', label: '概览', icon: 'Gauge' },
  problems: { section: 'problems', label: '题目列表', icon: 'PenLine' },
  records: { section: 'records', label: '提交列表', icon: 'Rows3' },
  ranking: { section: 'ranking', label: '排名', icon: 'ChartColumn' },
  notice: { section: 'notice', label: '公告', icon: 'Bell' },
  clar: { section: 'clar', label: '答疑', icon: 'MessageSquare' },
  print: { section: 'print', label: '打印', icon: 'Printer' },
} as const;

const CORE_RAIL = [RAIL.overview, RAIL.problems, RAIL.records];

const STATE_MARK: Record<CellState, readonly string[]> = {
  empty: ['border', 'border-dashed', 'border-line-strong'],
  draft: ['border', 'border-solid', 'bg-brand-soft', 'border-brand-line', 'text-brand-fg'],
  submitted: ['border', 'border-solid', 'bg-surface-active', 'border-line-strong'],
  correct: ['border', 'border-solid', 'bg-success-soft', 'border-success-line', 'text-success-fg'],
  wrong: ['border', 'border-solid', 'bg-danger-soft'],
  partial: ['border', 'border-solid', 'bg-info-soft'],
};

const FLAG_AFTER = [
  'after:absolute',
  'after:top-[3px]',
  'after:right-[3px]',
  'after:size-1.5',
  'after:rounded-full',
  'after:bg-warning',
  'after:content-[\'\']',
] as const;

const OTHER_FILLS: Record<CellState, readonly string[]> = {
  empty: ['bg-brand-soft', 'bg-surface-active', 'bg-success-soft', 'bg-danger-soft', 'bg-info-soft'],
  draft: ['border-dashed', 'bg-surface-active', 'bg-success-soft', 'bg-danger-soft', 'bg-info-soft'],
  submitted: ['border-dashed', 'bg-brand-soft', 'bg-success-soft', 'bg-danger-soft', 'bg-info-soft'],
  correct: ['border-dashed', 'bg-brand-soft', 'bg-surface-active', 'bg-danger-soft', 'bg-info-soft'],
  wrong: ['border-dashed', 'bg-brand-soft', 'bg-surface-active', 'bg-success-soft', 'bg-info-soft'],
  partial: ['border-dashed', 'bg-brand-soft', 'bg-surface-active', 'bg-success-soft', 'bg-danger-soft'],
};

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

async function loadModel(): Promise<WorkspaceModel> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(modelLoaders)) {
    if (key.endsWith(MODEL_SOURCE)) load = candidate;
  }
  expect(typeof load, `${MODEL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${MODEL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${MODEL_SOURCE} must be a module`);
  return {
    parseSetWorkspace: asFunction<WorkspaceModel['parseSetWorkspace']>(readField(imported, 'parseSetWorkspace'), 'parseSetWorkspace'),
    parseWorkspaceProblems: asFunction<WorkspaceModel['parseWorkspaceProblems']>(readField(imported, 'parseWorkspaceProblems'), 'parseWorkspaceProblems'),
    readSection: asFunction<WorkspaceModel['readSection']>(readField(imported, 'readSection'), 'readSection'),
    sectionHref: asFunction<WorkspaceModel['sectionHref']>(readField(imported, 'sectionHref'), 'sectionHref'),
    railItems: asFunction<WorkspaceModel['railItems']>(readField(imported, 'railItems'), 'railItems'),
    cellClass: asFunction<WorkspaceModel['cellClass']>(readField(imported, 'cellClass'), 'cellClass'),
    pendingKinds: asFunction<WorkspaceModel['pendingKinds']>(readField(imported, 'pendingKinds'), 'pendingKinds'),
    pendingCount: asFunction<WorkspaceModel['pendingCount']>(readField(imported, 'pendingCount'), 'pendingCount'),
    timerView: asFunction<WorkspaceModel['timerView']>(readField(imported, 'timerView'), 'timerView'),
    firstOpenTarget: asFunction<WorkspaceModel['firstOpenTarget']>(readField(imported, 'firstOpenTarget'), 'firstOpenTarget'),
  };
}

let loading: Promise<WorkspaceModel> | undefined;

function getModel(): Promise<WorkspaceModel> {
  loading ??= loadModel();
  return loading;
}

function item(pid: number, overrides: Partial<WsItem> = {}): WsItem {
  return {
    pid,
    label: `2-${pid}`,
    title: `题目 ${pid}`,
    kind: 'single',
    score: 5,
    state: 'empty',
    submits: 0,
    lastScore: null,
    ...overrides,
  };
}

function problemGroup(kind: ProblemKind, pids: readonly number[], overrides: Partial<WsGroup> = {}): WsGroup {
  return {
    kind,
    no: 1,
    name: kind,
    scoreEach: 5,
    items: pids.map((pid) => item(pid, { kind })),
    ...overrides,
  };
}

function atItem(source: WsGroup, index: number): WsItem {
  const found = source.items[index];
  if (!found) throw new TypeError(`missing item ${index}`);
  return found;
}

function windowOf(overrides: Partial<WsWindow> = {}): WsWindow {
  return {
    beginAt: '2026-10-16T08:00:00+08:00',
    endAt: '2026-10-22T23:59:00+08:00',
    dueAt: '2026-10-20T23:59:00+08:00',
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    lockAt: null,
    ...overrides,
  };
}

function actionOf(overrides: Partial<WsAction> = {}): WsAction {
  return {
    canStart: false,
    canFinalize: false,
    canAttend: false,
    canUnrank: false,
    canSubmit: true,
    attended: true,
    canRetake: false,
    ...overrides,
  };
}

function totalsOf(overrides: Partial<WsTotals> = {}): WsTotals {
  return {
    problemCount: 1,
    maxScore: 5,
    answered: 0,
    score: 0,
    accepted: null,
    showScore: true,
    ...overrides,
  };
}

function workspaceUrls(overview: string, overrides: Partial<WsUrls> = {}): WsUrls {
  return {
    back: '/training',
    manage: null,
    overview,
    problem: null,
    submit: `/p/__PID__/submit?tid=${TID}`,
    submitCode: null,
    recordDetail: `/record/__RID__?tid=${TID}`,
    records: `/record?tid=${TID}&uidOrName=62`,
    ranking: null,
    clarify: null,
    print: null,
    start: null,
    attend: null,
    draftList: `/homework/${TID}/draft`,
    draftUpsert: `/homework/${TID}/draft/__PID__`,
    submitKind: `/homework/${TID}/submit-kind`,
    lockKind: null,
    finalize: null,
    virtual: null,
    verifyObjective: null,
    verifySubmit: null,
    practice: null,
    teamProblem: null,
    pretest: null,
    ...overrides,
  };
}

function letterGroup(): WsGroup {
  return {
    kind: 'programming',
    no: null,
    name: '题目',
    scoreEach: null,
    items: [
      item(1, {
        label: 'A', title: '两数之和', kind: 'programming', score: 100, state: 'correct', submits: 1, lastScore: 40,
      }),
      item(2, {
        label: 'B', title: '括号序列', kind: 'programming', score: 100, state: 'empty', submits: 0, lastScore: null,
      }),
    ],
  };
}

interface WorkspacePatch extends Omit<Partial<SetWorkspace>, 'window' | 'urls' | 'action' | 'totals' | 'student'> {
  window?: Partial<WsWindow>;
  urls?: Partial<WsUrls>;
  action?: Partial<WsAction>;
  totals?: Partial<WsTotals>;
  student?: Partial<SetWorkspace['student']>;
}

function homeworkWorkspace(overrides: WorkspacePatch = {}): SetWorkspace {
  const base: SetWorkspace = {
    kind: 'homework',
    flavor: 'homework',
    tid: TID,
    title: '第 4 周 · 栈与队列',
    description: '截止前可以反复提交。',
    mode: 'browser',
    phase: 'answering',
    locked: null,
    numbering: 'pta',
    window: windowOf(),
    groups: [problemGroup('single', [11], { no: 2, name: '单选题' })],
    totals: totalsOf(),
    verdictVisible: true,
    objectiveVerdictVisible: true,
    team: null,
    paper: null,
    announcements: [ANNOUNCEMENT],
    clarifications: [],
    info: [{ label: '类型', text: '作业' }],
    student: { name: '张三', studentId: '2024010203' },
    action: actionOf(),
    urls: workspaceUrls(HOMEWORK_OVERVIEW),
  };
  return {
    ...base,
    ...overrides,
    window: { ...base.window, ...overrides.window },
    action: { ...base.action, ...overrides.action },
    totals: { ...base.totals, ...overrides.totals },
    student: { ...base.student, ...overrides.student },
    urls: { ...base.urls, ...overrides.urls },
  };
}

function paperWorkspace(overrides: WorkspacePatch = {}): SetWorkspace {
  const {
    urls: urlOverrides,
    window: windowOverrides,
    action: actionOverrides,
    totals: totalOverrides,
    student: studentOverrides,
    ...rest
  } = overrides;
  return homeworkWorkspace({
    kind: 'paper',
    flavor: 'paper',
    title: '数据结构期中考试',
    description: '',
    mode: 'preview',
    numbering: 'pta',
    groups: [problemGroup('single', [21], { no: 2, name: '单选题', items: [item(21, { lastScore: 0 })] })],
    totals: {
      ...totalsOf({ maxScore: 100, score: 86 }),
      ...totalOverrides,
    },
    verdictVisible: false,
    paper: PAPER_FACTS,
    announcements: [],
    clarifications: [CLARIFICATION],
    info: [{ label: '及格线', text: '60 分' }],
    student: { ...{ name: '张三', studentId: null }, ...studentOverrides },
    action: { ...actionOf({ canFinalize: true, canSubmit: true }), ...actionOverrides },
    window: {
      ...windowOf({
        beginAt: '2026-10-18T14:00:00+08:00',
        endAt: '2026-10-18T16:30:00+08:00',
        dueAt: null,
        durationMinutes: 120,
        personalEndAt: '2026-10-18T15:30:00+08:00',
      }),
      ...windowOverrides,
    },
    urls: {
      ...workspaceUrls(PAPER_OVERVIEW, {
        problem: null,
        submit: null,
        submitCode: `/paper/${TID}/submit-code/__PID__`,
        ranking: `/paper/${TID}/ranking`,
        start: `/paper/${TID}/start`,
        draftList: `/paper/${TID}/draft`,
        draftUpsert: `/paper/${TID}/draft/__PID__`,
        submitKind: null,
        lockKind: `/paper/${TID}/lock-kind`,
        finalize: `/paper/${TID}/finalize`,
      }),
      ...urlOverrides,
    },
    ...rest,
  });
}

function contestWorkspace(overrides: WorkspacePatch = {}): SetWorkspace {
  const {
    urls: urlOverrides,
    window: windowOverrides,
    action: actionOverrides,
    totals: totalOverrides,
    student: studentOverrides,
    ...rest
  } = overrides;
  return homeworkWorkspace({
    kind: 'contest',
    flavor: 'acm',
    title: '秋季校赛',
    description: '按通过题数和罚时排名。',
    mode: 'client',
    numbering: 'letter',
    groups: [letterGroup()],
    totals: {
      ...totalsOf({
        problemCount: 2, maxScore: null, answered: 1, score: null, accepted: 1,
      }),
      ...totalOverrides,
    },
    verdictVisible: true,
    team: { teamName: '红队', role: 'member' },
    paper: null,
    announcements: [ANNOUNCEMENT],
    clarifications: [CLARIFICATION],
    info: [
      { label: '类型', text: '考试 · ACM' },
      { label: '封榜', at: '2026-10-18T16:00:00+08:00' },
      { label: '时间', range: ['2026-10-18T13:00:00+08:00', '2026-10-18T17:00:00+08:00'] },
    ],
    student: { ...{ name: '张三', studentId: '2024010203' }, ...studentOverrides },
    action: { ...actionOf({ attended: true, canSubmit: true }), ...actionOverrides },
    window: {
      ...windowOf({
        beginAt: '2026-10-18T13:00:00+08:00',
        endAt: '2026-10-18T17:00:00+08:00',
        dueAt: null,
        durationMinutes: null,
        lockAt: '2026-10-18T16:00:00+08:00',
      }),
      ...windowOverrides,
    },
    urls: {
      ...workspaceUrls(CONTEST_OVERVIEW, {
        back: null,
        manage: null,
        problem: `/p/__PID__?tid=${TID}`,
        submit: `/p/__PID__/submit?tid=${TID}`,
        ranking: `/contest/${TID}/scoreboard`,
        clarify: `/contest/${TID}/problems`,
        print: `/exam-mode/${TID}/print`,
        attend: null,
        draftList: null,
        draftUpsert: null,
        submitKind: null,
      }),
      ...urlOverrides,
    },
    ...rest,
  });
}

function replaceField(source: object, key: string, value: unknown): unknown {
  const copy = structuredClone(source);
  Reflect.set(copy, key, value);
  return copy;
}

function deleteField(source: object, key: string): unknown {
  const copy = structuredClone(source);
  Reflect.deleteProperty(copy, key);
  return copy;
}

function nestedBucket(source: object, key: string): object {
  const copy = structuredClone(source);
  const bucket = Reflect.get(copy, key);
  if (typeof bucket !== 'object' || bucket === null) throw new TypeError(key);
  return copy;
}

function replaceNested(source: object, key: string, child: string, value: unknown): unknown {
  const copy = nestedBucket(source, key);
  const bucket = Reflect.get(copy, key);
  if (typeof bucket !== 'object' || bucket === null) throw new TypeError(key);
  Reflect.set(bucket, child, value);
  return copy;
}

function deleteNested(source: object, key: string, child: string): unknown {
  const copy = nestedBucket(source, key);
  const bucket = Reflect.get(copy, key);
  if (typeof bucket !== 'object' || bucket === null) throw new TypeError(key);
  Reflect.deleteProperty(bucket, child);
  return copy;
}

function withItemState(state: string): unknown {
  const copy = structuredClone(homeworkWorkspace());
  const first = copy.groups[0]?.items[0];
  if (!first) throw new TypeError('item');
  Reflect.set(first, 'state', state);
  return copy;
}

function withGroupKind(kind: string): unknown {
  const copy = structuredClone(homeworkWorkspace());
  const first = copy.groups[0];
  const problem = first?.items[0];
  if (!first || !problem) throw new TypeError('group');
  Reflect.set(first, 'kind', kind);
  Reflect.set(problem, 'kind', kind);
  return copy;
}

function withPid(pid: unknown): unknown {
  const copy = structuredClone(homeworkWorkspace());
  const first = copy.groups[0]?.items[0];
  if (!first) throw new TypeError('item');
  Reflect.set(first, 'pid', pid);
  return copy;
}

function draft(answers: WsDraft['answers'], submittedAnswers: WsDraft['submittedAnswers']): WsDraft {
  return { answers, submittedAnswers };
}

function classTokens(value: unknown): Set<string> {
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') throw new TypeError('cellClass must return a string');
  return new Set(value.split(/\s+/).filter((token) => token.length > 0));
}

function expectTokens(value: unknown, present: readonly string[], absent: readonly string[]): void {
  const tokens = classTokens(value);
  for (const token of present) expect(tokens, token).toContain(token);
  for (const token of absent) expect(tokens, token).not.toContain(token);
}

function problemRecord(
  pid: number,
  title: string,
  content: string,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    docId: `doc-${pid}`,
    pid,
    title,
    content,
    owner: '李老师',
  };
  if (config) record.config = config;
  return record;
}

function problemView(
  raw: Record<string, unknown>,
  questions: ObjectiveClientQuestion[] | null,
  programKind: ProgramKind | null,
): WorkspaceProblem {
  const title = raw.title;
  const content = raw.content;
  if (typeof title !== 'string' || typeof content !== 'string') throw new TypeError('fixture');
  return {
    title, content, questions, programKind, raw,
  };
}

describe('set workspace view model', () => {
  describe('parseSetWorkspace', () => {
    it('accepts a homework, a paper, and a contest payload', async () => {
      const model = await getModel();
      const homework = homeworkWorkspace();
      const paper = paperWorkspace();
      const contest = contestWorkspace();
      expect(model.parseSetWorkspace(homework)).toEqual(homework);
      expect(model.parseSetWorkspace(paper)).toEqual(paper);
      expect(model.parseSetWorkspace(contest)).toEqual(contest);
      if (!paper.paper) throw new TypeError('paper');
      const hiddenScore = paperWorkspace({
        paper: {
          ...paper.paper, score: null, passed: null, passScore: null, attemptLimit: null,
        },
      });
      expect(model.parseSetWorkspace(hiddenScore)).toEqual(hiddenScore);
    });

    it('accepts every documented enum', async () => {
      const model = await getModel();
      for (const phase of PHASES) {
        expect(model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'phase', phase)), phase).toMatchObject({ phase });
      }
      for (const kind of WORKSPACE_KINDS) {
        expect(model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'kind', kind)), kind).toMatchObject({ kind });
      }
      for (const flavor of FLAVORS) {
        expect(model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'flavor', flavor)), flavor).toMatchObject({ flavor });
      }
      for (const mode of MODES) {
        expect(model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'mode', mode)), mode).toMatchObject({ mode });
      }
      for (const numbering of NUMBERINGS) {
        expect(model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'numbering', numbering)), numbering).toMatchObject({ numbering });
      }
      for (const state of CELL_STATES) {
        expect(model.parseSetWorkspace(withItemState(state)), state).toMatchObject({ groups: [{ items: [{ state }] }] });
      }
      for (const reason of LOCK_REASONS) {
        expect(model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'locked', { reason })), reason).toMatchObject({ locked: { reason } });
      }
      for (const kind of KINDS) {
        expect(model.parseSetWorkspace(withGroupKind(kind)), kind).toMatchObject({ groups: [{ kind }] });
      }
      for (const role of ['captain', 'member'] as const) {
        const raw = replaceField(homeworkWorkspace(), 'team', { teamName: '红队', role });
        expect(model.parseSetWorkspace(raw), role).toMatchObject({ team: { role } });
      }
    });

    it('rejects a phase of xx', async () => {
      const model = await getModel();
      expect(() => model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'phase', 'xx'))).toThrow(TypeError);
    });

    it('rejects missing fields, wrong types, and enums outside the contract', async () => {
      const model = await getModel();
      const bad: Array<[string, unknown]> = [
        ['missing title', deleteField(homeworkWorkspace(), 'title')],
        ['missing description', deleteField(homeworkWorkspace(), 'description')],
        ['missing urls', deleteField(homeworkWorkspace(), 'urls')],
        ['missing student', deleteField(homeworkWorkspace(), 'student')],
        ['missing overview', deleteNested(homeworkWorkspace(), 'urls', 'overview')],
        ['missing endAt', deleteNested(homeworkWorkspace(), 'window', 'endAt')],
        ['missing canSubmit', deleteNested(homeworkWorkspace(), 'action', 'canSubmit')],
        ['records null', replaceNested(homeworkWorkspace(), 'urls', 'records', null)],
        ['overview null', replaceNested(homeworkWorkspace(), 'urls', 'overview', null)],
        ['beginAt number', replaceNested(homeworkWorkspace(), 'window', 'beginAt', 0)],
        ['tid number', replaceField(homeworkWorkspace(), 'tid', 12)],
        ['kind practice', replaceField(homeworkWorkspace(), 'kind', 'practice')],
        ['flavor practice', replaceField(homeworkWorkspace(), 'flavor', 'practice')],
        ['mode desktop', replaceField(homeworkWorkspace(), 'mode', 'desktop')],
        ['numbering numeric', replaceField(homeworkWorkspace(), 'numbering', 'numeric')],
        ['phase null', replaceField(homeworkWorkspace(), 'phase', null)],
        ['groups object', replaceField(homeworkWorkspace(), 'groups', {})],
        ['lock reason', replaceField(homeworkWorkspace(), 'locked', { reason: 'xx' })],
        ['lock missing reason', replaceField(homeworkWorkspace(), 'locked', {})],
        ['lock string', replaceField(homeworkWorkspace(), 'locked', 'client_only')],
        ['team role', replaceField(homeworkWorkspace(), 'team', { teamName: '红队', role: 'coach' })],
        ['attended number', replaceNested(homeworkWorkspace(), 'action', 'attended', 1)],
        ['showScore string', replaceNested(homeworkWorkspace(), 'totals', 'showScore', 'yes')],
        ['cell state', withItemState('skipped')],
        ['problem kind', withGroupKind('essay')],
        ['pid string', withPid('11')],
        ['null', null],
        ['array', []],
        ['string', 'homework'],
        ['number', 1],
      ];
      for (const [name, raw] of bad) {
        expect(() => model.parseSetWorkspace(raw), name).toThrow(TypeError);
      }
    });

    it('rejects an info row that is not exactly one of text, at, or range', async () => {
      const model = await getModel();
      const rows: Array<[string, unknown[]]> = [
        ['label only', [{ label: '类型' }]],
        ['text and at', [{ label: '类型', text: '作业', at: '2026-10-18T08:00:00+08:00' }]],
        ['short range', [{ label: '时间', range: ['2026-10-18T08:00:00+08:00'] }]],
        ['range types', [{ label: '时间', range: ['2026-10-18T08:00:00+08:00', 1] }]],
        ['missing label', [{ text: '作业' }]],
      ];
      for (const [name, info] of rows) {
        expect(() => model.parseSetWorkspace(replaceField(homeworkWorkspace(), 'info', info)), name).toThrow(TypeError);
      }
    });

    it('rejects a clarification that omits replies or reply content', async () => {
      const model = await getModel();
      const missingReplies = structuredClone(paperWorkspace());
      const clarification = missingReplies.clarifications[0];
      if (!clarification) throw new TypeError('clarification');
      Reflect.deleteProperty(clarification, 'replies');
      expect(() => model.parseSetWorkspace(missingReplies)).toThrow(TypeError);

      const missingContent = structuredClone(paperWorkspace());
      const reply = missingContent.clarifications[0]?.replies[0];
      if (!reply) throw new TypeError('reply');
      Reflect.deleteProperty(reply, 'content');
      expect(() => model.parseSetWorkspace(missingContent)).toThrow(TypeError);
    });
  });

  describe('parseWorkspaceProblems', () => {
    it('returns an empty map when the field is omitted or empty', async () => {
      const model = await getModel();
      expect(model.parseWorkspaceProblems(undefined)).toEqual(new Map());
      expect(model.parseWorkspaceProblems({})).toEqual(new Map());
    });

    it('reads objective questions and the program kind from config', async () => {
      const model = await getModel();
      const objective = problemRecord(101, '单选', '题面', { type: 'objective', questions: QUESTIONS });
      const fill = problemRecord(201, '程序填空', '填空题面', { type: 'program_fill', questions: QUESTIONS });
      const fn = problemRecord(202, '函数题', '函数题面', { type: 'function' });
      const programming = problemRecord(203, '编程题', '编程题面', { type: 'programming' });
      const emptyObjective = problemRecord(301, '空客观', '没有小题', { type: 'objective', questions: [] });
      const plain = problemRecord(401, '普通题', '默认配置', { type: 'default' });
      const unconfigured = problemRecord(501, '无配置', '只有题面', undefined);
      const raw = {
        101: objective,
        201: fill,
        202: fn,
        203: programming,
        301: emptyObjective,
        401: plain,
        501: unconfigured,
      };
      const parsed = model.parseWorkspaceProblems(raw);
      expect(parsed.size).toBe(7);
      expect(parsed.get(101)).toEqual(problemView(objective, QUESTIONS, null));
      expect(parsed.get(201)).toEqual(problemView(fill, null, 'program_fill'));
      expect(parsed.get(202)).toEqual(problemView(fn, null, 'function'));
      expect(parsed.get(203)).toEqual(problemView(programming, null, 'programming'));
      expect(parsed.get(301)).toEqual(problemView(emptyObjective, [], null));
      expect(parsed.get(401)).toEqual(problemView(plain, null, null));
      expect(parsed.get(501)).toEqual(problemView(unconfigured, null, null));
    });

    it('rejects a non-record and an item without a string title and content', async () => {
      const model = await getModel();
      const bad: Array<[string, unknown]> = [
        ['null', null],
        ['array', []],
        ['string', 'x'],
        ['number', 1],
        ['missing title', { 1: { content: '题面' } }],
        ['missing content', { 1: { title: '题' } }],
        ['title type', { 1: { title: 1, content: '题面' } }],
        ['content type', { 1: { title: '题', content: null } }],
        ['item null', { 1: null }],
        ['bad pid', { abc: { title: '题', content: '题面' } }],
      ];
      for (const [name, raw] of bad) {
        expect(() => model.parseWorkspaceProblems(raw), name).toThrow(TypeError);
      }
    });
  });

  // readSection only receives the query string. A section this workspace does
  // not show is decided by railItems; an unknown section name falls back here.
  describe('readSection', () => {
    it('reads each section, kind, and problem id', async () => {
      const model = await getModel();
      for (const section of SECTIONS) {
        expect(model.readSection(`?section=${section}`), section).toEqual({ section, kind: null, q: null });
      }
      for (const kind of KINDS) {
        expect(model.readSection(`?section=problems&kind=${kind}`), kind).toEqual({ section: 'problems', kind, q: null });
      }
      expect(model.readSection('section=records')).toEqual({ section: 'records', kind: null, q: null });
      expect(model.readSection('?section=problems&kind=single&q=12')).toEqual({ section: 'problems', kind: 'single', q: 12 });
      expect(model.readSection('?q=9')).toEqual({ section: 'overview', kind: null, q: 9 });
    });

    it('falls back to overview for an unknown or empty section', async () => {
      const model = await getModel();
      expect(model.readSection('?section=nope')).toEqual({ section: 'overview', kind: null, q: null });
      expect(model.readSection('?section=rank')).toEqual({ section: 'overview', kind: null, q: null });
      expect(model.readSection('?section=PRINT')).toEqual({ section: 'overview', kind: null, q: null });
      expect(model.readSection('')).toEqual({ section: 'overview', kind: null, q: null });
      expect(model.readSection('?section=')).toEqual({ section: 'overview', kind: null, q: null });
      expect(model.readSection('?section=nope&kind=single&q=4')).toEqual({ section: 'overview', kind: 'single', q: 4 });
    });

    it('drops a kind or problem id that is not usable', async () => {
      const model = await getModel();
      expect(model.readSection('?section=problems&kind=essay')).toEqual({ section: 'problems', kind: null, q: null });
      expect(model.readSection('?section=problems&kind=true-false')).toEqual({ section: 'problems', kind: null, q: null });
      expect(model.readSection('?section=problems&q=4.2')).toEqual({ section: 'problems', kind: null, q: null });
      expect(model.readSection('?section=problems&q=-1')).toEqual({ section: 'problems', kind: null, q: null });
      expect(model.readSection('?section=problems&q=4abc')).toEqual({ section: 'problems', kind: null, q: null });
      expect(model.readSection('?section=problems&q=')).toEqual({ section: 'problems', kind: null, q: null });
    });
  });

  describe('sectionHref', () => {
    it('appends the section and an optional kind or problem id', async () => {
      const model = await getModel();
      const homework = homeworkWorkspace();
      const contest = contestWorkspace();
      expect(model.sectionHref(homework, 'overview')).toBe(`${HOMEWORK_OVERVIEW}?section=overview`);
      expect(model.sectionHref(homework, 'records')).toBe(`${HOMEWORK_OVERVIEW}?section=records`);
      expect(model.sectionHref(homework, 'problems', { kind: 'true_false' })).toBe(`${HOMEWORK_OVERVIEW}?section=problems&kind=true_false`);
      expect(model.sectionHref(homework, 'problems', { q: 101 })).toBe(`${HOMEWORK_OVERVIEW}?section=problems&q=101`);
      expect(model.sectionHref(contest, 'print')).toBe(`${CONTEST_OVERVIEW}?section=print`);
    });
  });

  describe('railItems', () => {
    it('shows homework announcements when present without adding clarification', async () => {
      const model = await getModel();
      const homework = homeworkWorkspace({
        clarifications: [CLARIFICATION],
        urls: { clarify: `/homework/${TID}/problems` },
      });
      expect(model.railItems(homework)).toEqual([...CORE_RAIL, RAIL.notice]);
      const ranked = homeworkWorkspace({ urls: { ranking: `/homework/${TID}/scoreboard` } });
      expect(model.railItems(ranked)).toEqual([...CORE_RAIL, RAIL.ranking, RAIL.notice]);
    });

    it('shows notice on a paper or contest even when there are no announcements', async () => {
      const model = await getModel();
      const paper = paperWorkspace({ clarifications: [] });
      expect(model.railItems(paper)).toEqual([...CORE_RAIL, RAIL.ranking, RAIL.notice]);
    });

    it('shows clarification from the url or from the student questions', async () => {
      const model = await getModel();
      const fromQuestions = paperWorkspace();
      expect(model.railItems(fromQuestions)).toEqual([...CORE_RAIL, RAIL.ranking, RAIL.notice, RAIL.clar]);
      const fromUrl = contestWorkspace({
        clarifications: [],
        urls: { print: null },
      });
      expect(model.railItems(fromUrl)).toEqual([...CORE_RAIL, RAIL.ranking, RAIL.notice, RAIL.clar]);
    });

    it('includes print on a client contest that allows printing', async () => {
      const model = await getModel();
      expect(model.railItems(contestWorkspace())).toEqual([
        ...CORE_RAIL,
        RAIL.ranking,
        RAIL.notice,
        RAIL.clar,
        RAIL.print,
      ]);
    });

    it('omits ranking, clarification, and print when those urls are blank', async () => {
      const model = await getModel();
      const ws = contestWorkspace({
        clarifications: [],
        announcements: [],
        urls: { ranking: '', clarify: '', print: '' },
      });
      expect(model.railItems(ws)).toEqual([...CORE_RAIL, RAIL.notice]);
    });
  });

  describe('cellClass', () => {
    it('paints each answer state', async () => {
      const model = await getModel();
      for (const state of CELL_STATES) {
        expectTokens(
          model.cellClass(state, false, false),
          STATE_MARK[state],
          [...OTHER_FILLS[state], ...FLAG_AFTER, 'bg-warning', 'ring-2', 'ring-brand'],
        );
      }
    });

    it('adds the flag dot and the current ring without dropping the state', async () => {
      const model = await getModel();
      expectTokens(
        model.cellClass('empty', true, false),
        [...STATE_MARK.empty, 'relative', ...FLAG_AFTER],
        ['bg-warning', 'ring-2', 'ring-brand'],
      );
      expectTokens(
        model.cellClass('empty', false, true),
        [...STATE_MARK.empty, 'ring-2', 'ring-brand'],
        ['bg-warning', ...FLAG_AFTER],
      );
      expectTokens(
        model.cellClass('correct', true, true),
        [...STATE_MARK.correct, 'relative', ...FLAG_AFTER, 'ring-2', 'ring-brand'],
        ['bg-warning'],
      );
    });
  });

  // Drafts are keyed by pid. N counts a problem only when its answers are
  // non-empty and their canonical JSON differs from the last kind submit.
  describe('pending drafts', () => {
    it('counts only a non-empty draft that differs from the last submit', async () => {
      const model = await getModel();
      const single = problemGroup('single', [11, 12, 13, 14], { no: 2, name: '单选题' });
      const blank = problemGroup('blank', [21], { no: 4, name: '填空题' });
      const drafts = new Map<number, WsDraft>([
        [11, draft({ b: '1', a: '2' }, { a: '2', b: '1' })],
        [12, draft({ a: 'C' }, { a: 'B' })],
        [13, draft(null, null)],
        [14, draft({}, null)],
        [21, draft({ a: ['B', 'A'] }, { a: ['A', 'B'] })],
      ]);
      expect(model.pendingCount(single, drafts)).toBe(1);
      expect(model.pendingCount(blank, drafts)).toBe(0);

      const multi = problemGroup('multi', [31, 32, 33], { no: 3, name: '多选题' });
      const sparse = new Map<number, WsDraft>([
        [31, draft(null, { a: 'B' })],
        [32, draft({}, { a: 'B' })],
        [33, draft({ a: 'B' }, null)],
      ]);
      expect(model.pendingCount(multi, sparse)).toBe(1);
      expect(model.pendingCount(multi, new Map())).toBe(0);
    });

    it('ignores cell state and treats key order and array order as the same draft', async () => {
      const model = await getModel();
      const group = problemGroup('true_false', [41, 42], { no: 1, name: '判断题' });
      atItem(group, 0).state = 'draft';
      atItem(group, 1).state = 'empty';
      const drafts = new Map<number, WsDraft>([
        [41, draft({ a: 'T' }, { a: 'T' })],
        [42, draft({ choice: ['B', 'A'] }, { choice: ['A', 'B'] })],
      ]);
      expect(model.pendingCount(group, drafts)).toBe(0);

      const changed = new Map<number, WsDraft>([
        [41, draft({ a: 'T' }, { a: 'T' })],
        [42, draft({ a: 'F' }, { a: 'T' })],
      ]);
      expect(model.pendingCount(group, changed)).toBe(1);
    });

    it('lists pending kinds in group order', async () => {
      const model = await getModel();
      const judged = problemGroup('true_false', [1], { no: 1, name: '判断题' });
      const blank = problemGroup('blank', [2], { no: 4, name: '填空题' });
      const single = problemGroup('single', [3], { no: 2, name: '单选题' });
      const multi = problemGroup('multi', [4], { no: 3, name: '多选题' });
      const ws = homeworkWorkspace({
        groups: [judged, blank, single, multi],
        totals: totalsOf({ problemCount: 4 }),
      });
      const drafts = new Map<number, WsDraft>([
        [1, draft({ a: 'T' }, { a: 'T' })],
        [2, draft({ a: 'x' }, null)],
        [3, draft({ a: 'B' }, { a: 'B' })],
        [4, draft({ a: ['A'] }, { a: ['A', 'B'] })],
      ]);
      expect(model.pendingKinds(ws, drafts)).toEqual(['blank', 'multi']);
      expect(model.pendingKinds(ws, new Map())).toEqual([]);
    });
  });

  // Countdown labels: 距开考 for a paper, 距开始 for homework and ACM-class.
  // A countdown puts the instant in endAt and leaves text null. An untimed
  // homework deadline uses 截止 plus moment text and leaves endAt null.
  // Every other phase returns null. Tone is >5 minutes fg, ≤5 warning, ≤1 danger.
  describe('timerView', () => {
    it('counts an answering contest down to the personal end, otherwise the contest end', async () => {
      const model = await getModel();
      for (const flavor of CONTEST_FLAVORS) {
        const ws = contestWorkspace({
          flavor,
          phase: 'answering',
          window: {
            personalEndAt: '2026-10-18T16:00:00+08:00',
            endAt: '2026-10-18T15:00:00+08:00',
            dueAt: null,
          },
        });
        expect(model.timerView(ws, NOW), flavor).toEqual({
          label: '剩余',
          endAt: Date.parse('2026-10-18T16:00:00+08:00'),
          text: null,
          tone: 'fg',
        });
      }
      const contestEnd = contestWorkspace({
        phase: 'answering',
        window: {
          personalEndAt: null,
          endAt: '2026-10-18T15:00:00+08:00',
          dueAt: null,
        },
      });
      expect(model.timerView(contestEnd, NOW)).toEqual({
        label: '剩余',
        endAt: Date.parse('2026-10-18T15:00:00+08:00'),
        text: null,
        tone: 'fg',
      });
    });

    it('uses the danger tone when fifty nine seconds remain', async () => {
      const model = await getModel();
      const ws = contestWorkspace({
        phase: 'answering',
        window: {
          personalEndAt: null,
          endAt: '2026-10-18T14:00:59+08:00',
          dueAt: null,
        },
      });
      expect(model.timerView(ws, NOW)).toEqual({
        label: '剩余',
        endAt: Date.parse('2026-10-18T14:00:59+08:00'),
        text: null,
        tone: 'danger',
      });
    });

    it('sets the countdown tone from the five minute and one minute thresholds', async () => {
      const model = await getModel();
      const cases: Array<[string, string]> = [
        ['2026-10-18T14:05:01+08:00', 'fg'],
        ['2026-10-18T14:05:00+08:00', 'warning'],
        ['2026-10-18T14:01:01+08:00', 'warning'],
        ['2026-10-18T14:01:00+08:00', 'danger'],
      ];
      for (const [endAt, tone] of cases) {
        const ws = contestWorkspace({
          phase: 'answering',
          window: { personalEndAt: null, endAt, dueAt: null },
        });
        expect(model.timerView(ws, NOW), endAt).toEqual({
          label: '剩余',
          endAt: Date.parse(endAt),
          text: null,
          tone,
        });
      }
    });

    it('labels an upcoming paper as 距开考 and homework or a contest as 距开始', async () => {
      const model = await getModel();
      const beginAt = '2026-10-18T16:00:00+08:00';
      const window = {
        beginAt,
        endAt: '2026-10-18T18:00:00+08:00',
        dueAt: null,
        personalEndAt: null,
      };
      const paper = paperWorkspace({ phase: 'upcoming', window: { ...window, durationMinutes: 120 } });
      const homework = homeworkWorkspace({ phase: 'upcoming', window: { ...window, durationMinutes: 45 } });
      const contest = contestWorkspace({ phase: 'upcoming', window });
      const endAt = Date.parse(beginAt);
      expect(model.timerView(paper, NOW)).toEqual({
        label: '距开考', endAt, text: null, tone: 'fg',
      });
      expect(model.timerView(homework, NOW)).toEqual({
        label: '距开始', endAt, text: null, tone: 'fg',
      });
      expect(model.timerView(contest, NOW)).toEqual({
        label: '距开始', endAt, text: null, tone: 'fg',
      });
    });

    it('shows personal time left while a paper or a timed homework is open', async () => {
      const model = await getModel();
      const personalEndAt = '2026-10-18T15:30:00+08:00';
      const paper = paperWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: 120,
          personalEndAt,
          endAt: '2026-10-18T16:30:00+08:00',
          dueAt: null,
        },
      });
      const homework = homeworkWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: 45,
          personalEndAt: '2026-10-18T14:45:00+08:00',
          dueAt: '2026-10-20T23:59:00+08:00',
          endAt: '2026-10-22T23:59:00+08:00',
        },
      });
      expect(model.timerView(paper, NOW)).toEqual({
        label: '个人剩余',
        endAt: Date.parse(personalEndAt),
        text: null,
        tone: 'fg',
      });
      expect(model.timerView(homework, NOW)).toEqual({
        label: '个人剩余',
        endAt: Date.parse('2026-10-18T14:45:00+08:00'),
        text: null,
        tone: 'fg',
      });
      const openEnd = '2026-10-18T16:00:00+08:00';
      const untimedPaper = paperWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: null,
          personalEndAt: null,
          endAt: openEnd,
          dueAt: null,
        },
      });
      expect(model.timerView(untimedPaper, NOW)).toEqual({
        label: '个人剩余',
        endAt: Date.parse(openEnd),
        text: null,
        tone: 'fg',
      });
    });

    it('shows an untimed homework deadline as moment text', async () => {
      const model = await getModel();
      const later = homeworkWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: null,
          dueAt: '2026-10-20T23:59:00+08:00',
          endAt: '2026-10-22T23:59:00+08:00',
          personalEndAt: null,
        },
      });
      expect(model.timerView(later, NOW)).toEqual({
        label: '截止',
        endAt: null,
        text: '10/20 23:59',
        tone: 'fg',
      });

      const padded = homeworkWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: 0,
          dueAt: '2026-10-28T08:05:00+08:00',
          endAt: '2026-10-30T23:59:00+08:00',
          personalEndAt: null,
        },
      });
      expect(model.timerView(padded, NOW)).toEqual({
        label: '截止',
        endAt: null,
        text: '10/28 08:05',
        tone: 'fg',
      });

      const sameDay = homeworkWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: null,
          dueAt: null,
          endAt: '2026-10-18T18:05:00+08:00',
          personalEndAt: null,
        },
      });
      expect(model.timerView(sameDay, NOW)).toEqual({
        label: '截止',
        endAt: null,
        text: '18:05',
        tone: 'fg',
      });

      const nextYear = homeworkWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: null,
          dueAt: '2027-01-02T09:05:00+08:00',
          endAt: '2027-01-09T23:59:00+08:00',
          personalEndAt: null,
        },
      });
      expect(model.timerView(nextYear, NOW)).toEqual({
        label: '截止',
        endAt: null,
        text: '2027-01-02 09:05',
        tone: 'fg',
      });

      const lastMinute = homeworkWorkspace({
        phase: 'answering',
        window: {
          durationMinutes: null,
          dueAt: '2026-10-18T14:00:59+08:00',
          endAt: '2026-10-22T23:59:00+08:00',
          personalEndAt: null,
        },
      });
      expect(model.timerView(lastMinute, NOW)).toEqual({
        label: '截止',
        endAt: null,
        text: '14:00',
        tone: 'danger',
      });
    });

    it('returns null outside upcoming and answering', async () => {
      const model = await getModel();
      const samples = [
        paperWorkspace({ phase: 'ready' }),
        paperWorkspace({ phase: 'submitted' }),
        paperWorkspace({ phase: 'ended' }),
        homeworkWorkspace({ phase: 'ready' }),
        homeworkWorkspace({ phase: 'submitted' }),
        homeworkWorkspace({ phase: 'ended' }),
        contestWorkspace({ phase: 'ready' }),
        contestWorkspace({ phase: 'submitted' }),
        contestWorkspace({ phase: 'ended' }),
      ];
      for (const ws of samples) {
        expect(model.timerView(ws, NOW), `${ws.kind}:${ws.phase}`).toBeNull();
      }
    });
  });

  // A kind page returns q null. program_fill, function, and programming
  // return the pid of the first empty or draft problem.
  describe('firstOpenTarget', () => {
    it('opens the kind page when an objective or subjective group is unfinished', async () => {
      const model = await getModel();
      const done = problemGroup('true_false', [1, 2, 3, 4], { no: 1, name: '判断题' });
      const terminal = ['correct', 'wrong', 'partial', 'submitted'] as const;
      for (const [index, state] of terminal.entries()) atItem(done, index).state = state;
      const open = problemGroup('single', [5, 6], { no: 2, name: '单选题' });
      atItem(open, 0).state = 'correct';
      atItem(open, 1).state = 'draft';
      const ws = homeworkWorkspace({ groups: [done, open], totals: totalsOf({ problemCount: 6 }) });
      expect(model.firstOpenTarget(ws)).toEqual({ kind: 'single', q: null });

      const subjective = homeworkWorkspace({
        groups: [problemGroup('subjective', [8], { no: 8, name: '主观题' })],
      });
      expect(model.firstOpenTarget(subjective)).toEqual({ kind: 'subjective', q: null });
    });

    it('opens the first unfinished problem on a one-per-page kind', async () => {
      const model = await getModel();
      const programming = problemGroup('programming', [71, 72, 73], { no: 7, name: '编程题' });
      atItem(programming, 0).state = 'correct';
      atItem(programming, 1).state = 'draft';
      atItem(programming, 2).state = 'empty';
      const ws = homeworkWorkspace({ groups: [programming] });
      expect(model.firstOpenTarget(ws)).toEqual({ kind: 'programming', q: 72 });

      const fill = problemGroup('program_fill', [51], { no: 5, name: '程序填空题' });
      atItem(fill, 0).state = 'correct';
      const fn = problemGroup('function', [61, 62], { no: 6, name: '函数题' });
      atItem(fn, 0).state = 'submitted';
      atItem(fn, 1).state = 'empty';
      const later = homeworkWorkspace({ groups: [fill, fn] });
      expect(model.firstOpenTarget(later)).toEqual({ kind: 'function', q: 62 });

      const contest = contestWorkspace();
      const letter = contest.groups[0];
      if (!letter) throw new TypeError('group');
      atItem(letter, 0).state = 'wrong';
      atItem(letter, 1).state = 'empty';
      expect(model.firstOpenTarget(contest)).toEqual({ kind: 'programming', q: 2 });
    });

    it('returns null when every problem is already submitted', async () => {
      const model = await getModel();
      const done = problemGroup('single', [1], { no: 2, name: '单选题' });
      atItem(done, 0).state = 'submitted';
      expect(model.firstOpenTarget(homeworkWorkspace({ groups: [done] }))).toBeNull();
      expect(model.firstOpenTarget(homeworkWorkspace({ groups: [] }))).toBeNull();
    });
  });
});
