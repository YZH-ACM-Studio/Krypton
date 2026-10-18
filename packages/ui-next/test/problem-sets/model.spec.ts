// @vitest-environment node
// A static import fails collection while src/pages/problem-sets/model.ts is absent.
import { describe, expect, it } from 'vitest';

// The sample instant in Lane U1 is 2026-10-18T14:00:00+08:00. Pin that calendar
// so same-day and same-year text does not follow the runner's zone.
process.env.TZ = 'Asia/Shanghai';

const modelLoaders = import.meta.glob('../../src/pages/problem-sets/model.ts');
const MODEL_SOURCE = 'src/pages/problem-sets/model.ts';

const SEP = ' \u00B7 ';
const DASH = '\u2014';
const LATE = '已过截止\uFF0C迟交会扣分';
const TEAM_FALLBACK = '每队 1\u20133 人';

const PAPER = `考试${SEP}试卷`;
const ACM = `考试${SEP}ACM`;
const IOI = `考试${SEP}IOI`;
const OI = `考试${SEP}OI`;

const NOW_ISO = '2026-10-18T14:00:00+08:00';
const NOW = Date.parse(NOW_ISO);
const SAME_DAY_BEGIN = '2026-10-18T08:00:00+08:00';
const SAME_DAY_END = '2026-10-18T18:00:00+08:00';
const NINETY_MIN_END = '2026-10-18T15:30:00+08:00';
const PERSONAL_END = '2026-10-18T15:40:00+08:00';
const HOMEWORK_PERSONAL_END = '2026-10-18T15:00:00+08:00';
const STARTED = '2026-10-18T13:00:00+08:00';
const HOUR_AGO = '2026-10-18T13:00:00+08:00';
const PLUS_TWO_DAYS = '2026-10-20T14:00:00+08:00';
const PLUS_FOUR_DAYS = '2026-10-22T14:00:00+08:00';

const EXAM_HREF = '/contest/64b8000000000000000000a1';
const HOMEWORK_HREF = '/homework/64b8000000000000000000a2';
const PRACTICE_HREF = '/problem-sets/64b8000000000000000000b1';
const TEAM_HREF = '/teams/batch-1';

type StudentSetsTab = 'running' | 'upcoming' | 'practice' | 'ended';
type ContestFlavor = 'paper' | 'acm' | 'ioi' | 'oi' | 'homework';
type RowTone = 'neutral' | 'warning';

interface ContestRow {
  kind: 'exam' | 'homework';
  id: string;
  flavor: ContestFlavor;
  title: string;
  href: string;
  beginAt: string;
  endAt: string;
  dueAt: string | null;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
  attended: boolean;
  clientRequired: boolean;
  team: boolean;
  problemCount: number;
  progress: { answered: number } | { accepted: number } | { score: number } | null;
  finalized: boolean;
  done: boolean;
}

interface PracticeRow {
  kind: 'practice';
  id: string;
  title: string;
  href: string;
  stageCount: number;
  problemCount: number;
  doneCount: number;
  sourceLabel: string;
}

interface TeamRow {
  kind: 'team';
  id: string;
  title: string;
  href: string;
  description: string;
  myState: 'none' | 'invited' | 'joined';
  inviteCount: number;
  memberCount: number | null;
}

type StudentSetRow = ContestRow | PracticeRow | TeamRow;

interface EndedRow {
  kind: 'exam' | 'homework';
  id: string;
  flavor: ContestFlavor;
  title: string;
  href: string;
  endAt: string;
  result: { kind: 'absent' } | { kind: 'hidden' } | { kind: 'score'; score: number } | { kind: 'accepted'; accepted: number };
}

interface StudentSetsBody {
  tab: StudentSetsTab;
  counts: { running: number; upcoming: number; practice: number };
  rows: StudentSetRow[];
  practice: { page: number; pageCount: number; q: string } | null;
  ended: {
    rows: EndedRow[];
    page: number;
    pageCount: number;
    total: number;
    type: 'all' | 'exam' | 'homework';
    q: string;
  } | null;
}

interface RowView {
  typeLabel: string;
  meta: string;
  time: { kind: 'text'; text: string } | { kind: 'countdown'; endAt: number; label: '剩余' };
  sub: { text: string; tone: RowTone } | null;
  progress: { text: string; ratio: number | null } | null;
  action: { label: string; variant: 'soft' | 'ghost'; href: string; target: 'overview' | 'problems' } | null;
  done: boolean;
}

interface SetsModel {
  parseStudentSets: (raw: unknown) => StudentSetsBody;
  studentSetRowView: (row: StudentSetRow, now: number) => RowView;
  endedResultText: (result: EndedRow['result']) => string;
  formatMoment: (iso: string, now: number) => string;
  formatDate: (iso: string, now: number) => string;
  durationText: (ms: number) => string;
}

interface ExpectedAction {
  label: string;
  variant: 'soft' | 'ghost';
  href: string;
  target?: 'overview' | 'problems';
}

interface ExpectedRow {
  typeLabel: string;
  meta: string;
  time: RowView['time'];
  sub?: RowView['sub'];
  progress?: RowView['progress'];
  action: ExpectedAction;
  done: boolean;
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

async function loadModel(): Promise<SetsModel> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(modelLoaders)) {
    if (key.endsWith(MODEL_SOURCE)) load = candidate;
  }
  expect(typeof load, `${MODEL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${MODEL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${MODEL_SOURCE} must be a module`);
  return {
    parseStudentSets: asFunction<SetsModel['parseStudentSets']>(readField(imported, 'parseStudentSets'), 'parseStudentSets'),
    studentSetRowView: asFunction<SetsModel['studentSetRowView']>(readField(imported, 'studentSetRowView'), 'studentSetRowView'),
    endedResultText: asFunction<SetsModel['endedResultText']>(readField(imported, 'endedResultText'), 'endedResultText'),
    formatMoment: asFunction<SetsModel['formatMoment']>(readField(imported, 'formatMoment'), 'formatMoment'),
    formatDate: asFunction<SetsModel['formatDate']>(readField(imported, 'formatDate'), 'formatDate'),
    durationText: asFunction<SetsModel['durationText']>(readField(imported, 'durationText'), 'durationText'),
  };
}

function contestMeta(count: number, parts: readonly string[] = []): string {
  return [`${count} 题`, ...parts].join(SEP);
}

function textTime(text: string): RowView['time'] {
  return { kind: 'text', text };
}

function countdownAt(iso: string): RowView['time'] {
  return { kind: 'countdown', endAt: Date.parse(iso), label: '剩余' };
}

function note(text: string, tone: RowTone = 'neutral'): NonNullable<RowView['sub']> {
  return { text, tone };
}

function meter(text: string, ratio: number | null = null): NonNullable<RowView['progress']> {
  return { text, ratio };
}

function contestRow(overrides: Partial<ContestRow> & Pick<ContestRow, 'kind' | 'flavor'>): ContestRow {
  return {
    id: '64b8000000000000000000a1',
    title: '数据结构期中考试',
    href: EXAM_HREF,
    beginAt: SAME_DAY_BEGIN,
    endAt: SAME_DAY_END,
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: false,
    clientRequired: false,
    team: false,
    problemCount: 20,
    progress: null,
    finalized: false,
    done: false,
    ...overrides,
  };
}

function practiceRow(overrides: Partial<PracticeRow> = {}): PracticeRow {
  return {
    kind: 'practice',
    id: '64b8000000000000000000b1',
    title: 'PAT 甲级训练集',
    href: PRACTICE_HREF,
    stageCount: 3,
    problemCount: 120,
    doneCount: 0,
    sourceLabel: '全站公开',
    ...overrides,
  };
}

function teamRow(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    kind: 'team',
    id: 'batch-1',
    title: '2026 秋季校赛组队',
    href: TEAM_HREF,
    description: '',
    myState: 'none',
    inviteCount: 0,
    memberCount: null,
    ...overrides,
  };
}

function runningFixture(): StudentSetsBody {
  return {
    tab: 'running',
    counts: { running: 2, upcoming: 1, practice: 4 },
    rows: [
      contestRow({ kind: 'exam', flavor: 'paper', title: '数据结构期中考试' }),
      teamRow({ description: '一起准备校赛', myState: 'invited', inviteCount: 2 }),
    ],
    practice: null,
    ended: null,
  };
}

function practiceFixture(): StudentSetsBody {
  return {
    tab: 'practice',
    counts: { running: 0, upcoming: 0, practice: 8 },
    rows: [practiceRow({ sourceLabel: '课程' })],
    practice: { page: 2, pageCount: 3, q: '指针' },
    ended: null,
  };
}

function endedFixture(): StudentSetsBody {
  return {
    tab: 'ended',
    counts: { running: 0, upcoming: 1, practice: 4 },
    rows: [],
    practice: null,
    ended: {
      page: 2,
      pageCount: 3,
      total: 41,
      type: 'all',
      q: '链表',
      rows: [
        {
          kind: 'exam',
          id: '64b8000000000000000000c1',
          flavor: 'paper',
          title: 'C 语言期中考试',
          href: '/contest/64b8000000000000000000c1',
          endAt: '2026-10-09T12:00:00+08:00',
          result: { kind: 'score', score: 86 },
        },
        {
          kind: 'homework',
          id: '64b8000000000000000000c2',
          flavor: 'homework',
          title: '第 1 周 · 输入输出',
          href: '/homework/64b8000000000000000000c2',
          endAt: '2026-10-06T23:59:00+08:00',
          result: { kind: 'absent' },
        },
        {
          kind: 'exam',
          id: '64b8000000000000000000c3',
          flavor: 'acm',
          title: '暑期训练赛',
          href: '/contest/64b8000000000000000000c3',
          endAt: '2026-07-28T18:00:00+08:00',
          result: { kind: 'accepted', accepted: 3 },
        },
        {
          kind: 'exam',
          id: '64b8000000000000000000c4',
          flavor: 'ioi',
          title: '程序设计基础期末上机',
          href: '/contest/64b8000000000000000000c4',
          endAt: '2025-01-08T09:00:00+08:00',
          result: { kind: 'hidden' },
        },
      ],
    },
  };
}

function homeworkRow(overrides: Partial<ContestRow> = {}): ContestRow {
  return contestRow({
    kind: 'homework',
    flavor: 'homework',
    title: '第 4 周 · 栈与队列',
    href: HOMEWORK_HREF,
    problemCount: 12,
    ...overrides,
  });
}

function upcomingRow(overrides: Partial<ContestRow> & Pick<ContestRow, 'kind' | 'flavor'>): ContestRow {
  return contestRow({
    beginAt: PLUS_TWO_DAYS,
    endAt: PLUS_FOUR_DAYS,
    ...overrides,
  });
}

async function viewOf(row: StudentSetRow): Promise<RowView> {
  const model = await loadModel();
  return model.studentSetRowView(row, NOW);
}

function expectRow(view: RowView, expected: ExpectedRow): void {
  expect(view.typeLabel).toBe(expected.typeLabel);
  expect(view.meta).toBe(expected.meta);
  expect(view.time).toEqual(expected.time);
  expect(view.done).toBe(expected.done);
  if (expected.sub !== undefined) expect(view.sub).toEqual(expected.sub);
  if (expected.progress !== undefined) expect(view.progress).toEqual(expected.progress);
  const action: ExpectedAction = {
    label: expected.action.label,
    variant: expected.action.variant,
    href: expected.action.href,
  };
  if (expected.action.target !== undefined) action.target = expected.action.target;
  expect(view.action).toMatchObject(action);
}

describe('problem sets view model', () => {
  it('parses a running list of exam and team rows', async () => {
    const model = await loadModel();
    const fixture = runningFixture();
    expect(model.parseStudentSets(fixture)).toMatchObject(fixture);
  });

  it('parses a practice page', async () => {
    const model = await loadModel();
    const fixture = practiceFixture();
    expect(model.parseStudentSets(fixture)).toMatchObject(fixture);
  });

  it('parses an ended page', async () => {
    const model = await loadModel();
    const fixture = endedFixture();
    expect(model.parseStudentSets(fixture)).toMatchObject(fixture);
  });

  it('rejects a payload that omits counts', async () => {
    const model = await loadModel();
    const { counts: _counts, ...rest } = runningFixture();
    expect(() => model.parseStudentSets(rest)).toThrow(TypeError);
  });

  it('rejects a payload whose rows are not an array', async () => {
    const model = await loadModel();
    const fixture = runningFixture();
    expect(() => model.parseStudentSets({ ...fixture, rows: {} })).toThrow(TypeError);
  });

  it('rejects a row whose kind is unknown', async () => {
    const model = await loadModel();
    const fixture = runningFixture();
    const rows = fixture.rows.map((row, index) => (index === 0 ? { ...row, kind: 'contest' } : row));
    expect(() => model.parseStudentSets({ ...fixture, rows })).toThrow(TypeError);
  });

  it('formats zero as one minute, ninety minutes, and two exact days', async () => {
    const model = await loadModel();
    expect(model.durationText(0)).toBe('1 分钟');
    expect(model.durationText(90 * 60e3)).toBe('1 小时 30 分钟');
    expect(model.durationText(2 * 864e5)).toBe('2 天');
  });

  it('omits a zero hour or minute part and keeps a non-zero part', async () => {
    const model = await loadModel();
    expect(model.durationText(45 * 60e3)).toBe('45 分钟');
    expect(model.durationText(60 * 60e3)).toBe('1 小时');
    expect(model.durationText(864e5)).toBe('1 天');
    expect(model.durationText(864e5 + (2 * 60 * 60e3))).toBe('1 天 2 小时');
  });

  it('formats a moment as a clock, a month and day, or a full date', async () => {
    const model = await loadModel();
    expect(model.formatMoment('2026-10-18T09:05:00+08:00', NOW)).toBe('09:05');
    expect(model.formatMoment('2026-01-05T09:05:00+08:00', NOW)).toBe('01/05 09:05');
    expect(model.formatMoment('2025-01-05T09:05:00+08:00', NOW)).toBe('2025-01-05 09:05');
  });

  it('formats a date as month and day in the same year, otherwise the full date', async () => {
    const model = await loadModel();
    expect(model.formatDate('2026-03-07T00:30:00+08:00', NOW)).toBe('03/07');
    expect(model.formatDate('2025-03-07T00:30:00+08:00', NOW)).toBe('2025-03-07');
  });

  it('formats an ended result as absent, hidden, score, or accepted', async () => {
    const model = await loadModel();
    expect(model.endedResultText({ kind: 'absent' })).toBe('未参加');
    expect(model.endedResultText({ kind: 'hidden' })).toBe('未公布');
    expect(model.endedResultText({ kind: 'score', score: 86 })).toBe('86 分');
    expect(model.endedResultText({ kind: 'accepted', accepted: 3 })).toBe('通过 3 题');
  });

  it('shows an open batch before the student has a team', async () => {
    const view = await viewOf(teamRow());
    expectRow(view, {
      typeLabel: '组队',
      meta: TEAM_FALLBACK,
      time: textTime('开放中'),
      sub: null,
      progress: meter('还没有队伍'),
      action: { label: '去组队', variant: 'soft', href: TEAM_HREF, target: 'overview' },
      done: false,
    });
  });

  it('shows how many invites are waiting', async () => {
    const view = await viewOf(teamRow({
      description: '一起准备校赛',
      myState: 'invited',
      inviteCount: 2,
    }));
    expectRow(view, {
      typeLabel: '组队',
      meta: '一起准备校赛',
      time: textTime('开放中'),
      sub: null,
      progress: meter('2 个邀请'),
      action: { label: '去组队', variant: 'soft', href: TEAM_HREF, target: 'overview' },
      done: false,
    });
  });

  it('shows a joined team as a view link', async () => {
    const view = await viewOf(teamRow({
      description: '算法校队',
      myState: 'joined',
      memberCount: 2,
    }));
    expectRow(view, {
      typeLabel: '组队',
      meta: '算法校队',
      time: textTime('开放中'),
      sub: null,
      progress: meter('已组队 2/3'),
      action: { label: '查看', variant: 'ghost', href: TEAM_HREF, target: 'overview' },
      done: false,
    });
  });

  it('shows a practice that has not been started', async () => {
    const view = await viewOf(practiceRow({ stageCount: 3, problemCount: 120, doneCount: 0, sourceLabel: '全站公开' }));
    expectRow(view, {
      typeLabel: '练习',
      meta: `3 个阶段${SEP}120 题${SEP}全站公开`,
      time: textTime('不限时间'),
      sub: note('还没开始'),
      progress: meter('0 / 120', 0),
      action: { label: '开始', variant: 'ghost', href: PRACTICE_HREF },
      done: false,
    });
  });

  it('omits the stage segment when a practice has one stage', async () => {
    const view = await viewOf(practiceRow({ stageCount: 1, problemCount: 18, doneCount: 0, sourceLabel: '课程' }));
    expectRow(view, {
      typeLabel: '练习',
      meta: `18 题${SEP}课程`,
      time: textTime('不限时间'),
      sub: note('还没开始'),
      progress: meter('0 / 18', 0),
      action: { label: '开始', variant: 'ghost', href: PRACTICE_HREF },
      done: false,
    });
  });

  it('rounds a practice completion percent and offers to continue', async () => {
    const view = await viewOf(practiceRow({
      stageCount: 4,
      problemCount: 3,
      doneCount: 2,
      sourceLabel: '用户组',
    }));
    expectRow(view, {
      typeLabel: '练习',
      meta: `4 个阶段${SEP}3 题${SEP}用户组`,
      time: textTime('不限时间'),
      sub: note('已完成 67%'),
      progress: meter('2 / 3', 2 / 3),
      action: { label: '继续', variant: 'soft', href: PRACTICE_HREF },
      done: false,
    });
  });

  it('uses a zero ratio when a practice has no problems', async () => {
    const view = await viewOf(practiceRow({ stageCount: 0, problemCount: 0, doneCount: 0, sourceLabel: '全站公开' }));
    expectRow(view, {
      typeLabel: '练习',
      meta: `0 题${SEP}全站公开`,
      time: textTime('不限时间'),
      sub: note('还没开始'),
      progress: meter('0 / 0', 0),
      action: { label: '开始', variant: 'ghost', href: PRACTICE_HREF },
      done: false,
    });
  });

  it('shows the lab-client notice for a running contest that requires the client', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'acm',
      title: 'C 语言期末上机',
      problemCount: 4,
      clientRequired: true,
      attended: true,
      startAt: STARTED,
      personalEndAt: PERSONAL_END,
      progress: { accepted: 1 },
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(4, ['机房客户端考试']),
      time: textTime('18:00 结束'),
      sub: note('只能在机房客户端进入'),
      progress: meter(DASH),
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: false,
    });
  });

  it('shows a submitted paper as handed in', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'paper',
      finalized: true,
      done: true,
      startAt: STARTED,
      personalEndAt: PERSONAL_END,
      durationMinutes: 120,
      progress: { answered: 20 },
    }));
    expectRow(view, {
      typeLabel: PAPER,
      meta: contestMeta(20, ['个人限时 120 分钟']),
      time: textTime('已交卷'),
      sub: note('考试 18:00 结束'),
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: true,
    });
  });

  it('counts down a paper that is in progress', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'paper',
      startAt: STARTED,
      personalEndAt: PERSONAL_END,
      durationMinutes: 100,
      progress: { answered: 7 },
    }));
    expectRow(view, {
      typeLabel: PAPER,
      meta: contestMeta(20, ['个人限时 100 分钟']),
      time: countdownAt(PERSONAL_END),
      sub: note('个人截止 15:40'),
      progress: meter('已答 7/20'),
      action: { label: '继续作答', variant: 'soft', href: EXAM_HREF, target: 'problems' },
      done: false,
    });
  });

  it('shows that a paper personal deadline has arrived', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'paper',
      startAt: STARTED,
      personalEndAt: NOW_ISO,
      durationMinutes: 120,
      done: true,
      progress: { answered: 11 },
    }));
    expectRow(view, {
      typeLabel: PAPER,
      meta: contestMeta(20, ['个人限时 120 分钟']),
      time: textTime('作答时间已到'),
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: true,
    });
  });

  it('offers to start a timed paper that has not been opened', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'paper',
      durationMinutes: 120,
    }));
    expectRow(view, {
      typeLabel: PAPER,
      meta: contestMeta(20, ['个人限时 120 分钟']),
      time: textTime('18:00 前开始'),
      sub: note('限时 120 分钟'),
      progress: meter('未开始'),
      action: { label: '开始作答', variant: 'soft', href: EXAM_HREF },
      done: false,
    });
  });

  it('offers to start an untimed paper that has not been opened', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'paper',
      endAt: PLUS_TWO_DAYS,
    }));
    expectRow(view, {
      typeLabel: PAPER,
      meta: contestMeta(20),
      time: textTime('10/20 14:00 结束'),
      sub: note('还有 2 天'),
      progress: meter('未开始'),
      action: { label: '开始作答', variant: 'soft', href: EXAM_HREF },
      done: false,
    });
  });

  it('counts down a registered acm contest to the personal end', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'acm',
      title: '校赛热身赛',
      problemCount: 5,
      attended: true,
      startAt: STARTED,
      personalEndAt: PERSONAL_END,
      durationMinutes: 120,
      progress: { accepted: 3 },
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(5, ['个人限时 120 分钟']),
      time: countdownAt(PERSONAL_END),
      sub: note('18:00 结束'),
      progress: meter('通过 3/5'),
      action: { label: '进入', variant: 'soft', href: EXAM_HREF, target: 'problems' },
      done: false,
    });
  });

  it('counts a registered acm contest down to the contest end when there is no personal end', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'acm',
      title: '校赛热身赛',
      problemCount: 5,
      attended: true,
      progress: { accepted: 1 },
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(5),
      time: countdownAt(SAME_DAY_END),
      sub: note('18:00 结束'),
      progress: meter('通过 1/5'),
      action: { label: '进入', variant: 'soft', href: EXAM_HREF, target: 'problems' },
      done: false,
    });
  });

  it('shows an ioi score for a registered contest', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'ioi',
      title: '校内模拟赛',
      problemCount: 4,
      attended: true,
      progress: { score: 245 },
    }));
    expectRow(view, {
      typeLabel: IOI,
      meta: contestMeta(4),
      time: countdownAt(SAME_DAY_END),
      sub: note('18:00 结束'),
      progress: meter('245 分'),
      action: { label: '进入', variant: 'soft', href: EXAM_HREF, target: 'problems' },
      done: false,
    });
  });

  it('shows an oi score for a registered contest', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'oi',
      title: '普及组模拟',
      problemCount: 4,
      attended: true,
      progress: { score: 90 },
    }));
    expectRow(view, {
      typeLabel: OI,
      meta: contestMeta(4),
      time: countdownAt(SAME_DAY_END),
      sub: note('18:00 结束'),
      progress: meter('90 分'),
      action: { label: '进入', variant: 'soft', href: EXAM_HREF, target: 'problems' },
      done: false,
    });
  });

  it('offers registration for a running individual contest', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'acm',
      title: '校赛热身赛',
      problemCount: 5,
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(5),
      time: countdownAt(SAME_DAY_END),
      sub: note('18:00 结束'),
      progress: meter('未报名'),
      action: { label: '报名', variant: 'soft', href: EXAM_HREF },
      done: false,
    });
  });

  it('shows a view action for a running team contest that is not registered', async () => {
    const view = await viewOf(contestRow({
      kind: 'exam',
      flavor: 'acm',
      title: '秋季校赛',
      problemCount: 5,
      team: true,
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(5, ['团队赛']),
      time: countdownAt(SAME_DAY_END),
      sub: note('18:00 结束'),
      progress: meter('未报名'),
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: false,
    });
  });

  it('shows the personal limit while a timed homework still has time to start', async () => {
    const view = await viewOf(homeworkRow({ durationMinutes: 45 }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(12, ['个人限时 45 分钟']),
      time: textTime('18:00 前开始'),
      sub: note('个人限时 45 分钟'),
      progress: meter('未开始'),
      action: { label: '开始作答', variant: 'soft', href: HOMEWORK_HREF },
      done: false,
    });
  });

  it('keeps the personal limit when the remaining time equals that limit', async () => {
    const view = await viewOf(homeworkRow({ durationMinutes: 90, endAt: NINETY_MIN_END }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(12, ['个人限时 90 分钟']),
      time: textTime('15:30 前开始'),
      sub: note('个人限时 90 分钟'),
      progress: meter('未开始'),
      action: { label: '开始作答', variant: 'soft', href: HOMEWORK_HREF },
      done: false,
    });
  });

  it('warns when less than the personal limit remains before a homework ends', async () => {
    const view = await viewOf(homeworkRow({ durationMinutes: 91, endAt: NINETY_MIN_END }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(12, ['个人限时 91 分钟']),
      time: textTime('15:30 前开始'),
      sub: note('只剩 1 小时 30 分钟', 'warning'),
      progress: meter('未开始'),
      action: { label: '开始作答', variant: 'soft', href: HOMEWORK_HREF },
      done: false,
    });
  });

  it('counts down a timed homework that is in progress', async () => {
    const view = await viewOf(homeworkRow({
      durationMinutes: 45,
      startAt: STARTED,
      personalEndAt: HOMEWORK_PERSONAL_END,
      progress: { answered: 4 },
    }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(12, ['个人限时 45 分钟']),
      time: countdownAt(HOMEWORK_PERSONAL_END),
      sub: note('个人截止 15:00'),
      progress: meter('4/12'),
      action: { label: '继续', variant: 'soft', href: HOMEWORK_HREF, target: 'problems' },
      done: false,
    });
  });

  it('shows the due time of an untimed homework that is still open', async () => {
    const view = await viewOf(homeworkRow({
      problemCount: 20,
      dueAt: PLUS_TWO_DAYS,
      endAt: PLUS_FOUR_DAYS,
      progress: { answered: 14 },
    }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(20),
      time: textTime('10/20 14:00 截止'),
      sub: note('还有 2 天'),
      progress: meter('14/20'),
      action: { label: '去做', variant: 'soft', href: HOMEWORK_HREF, target: 'problems' },
      done: false,
    });
  });

  it('warns once an untimed homework is past its due time', async () => {
    const view = await viewOf(homeworkRow({
      problemCount: 20,
      dueAt: HOUR_AGO,
      endAt: PLUS_TWO_DAYS,
      progress: { answered: 3 },
    }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(20),
      time: textTime('10/20 14:00 截止迟交'),
      sub: note(LATE, 'warning'),
      progress: meter('3/20'),
      action: { label: '去做', variant: 'soft', href: HOMEWORK_HREF, target: 'problems' },
      done: false,
    });
  });

  it('shows that an untimed homework is fully submitted', async () => {
    const view = await viewOf(homeworkRow({
      problemCount: 20,
      dueAt: PLUS_TWO_DAYS,
      endAt: PLUS_FOUR_DAYS,
      progress: { answered: 20 },
      done: true,
    }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(20),
      time: textTime('10/20 14:00 截止'),
      sub: note('已全部提交'),
      progress: meter('20/20'),
      action: { label: '查看', variant: 'ghost', href: HOMEWORK_HREF },
      done: true,
    });
  });

  it('says an upcoming homework opens', async () => {
    const view = await viewOf(upcomingRow({
      kind: 'homework',
      flavor: 'homework',
      title: '第 5 周 · 二叉树',
      href: HOMEWORK_HREF,
      problemCount: 18,
    }));
    expectRow(view, {
      typeLabel: '作业',
      meta: contestMeta(18),
      time: textTime('10/20 14:00 开放'),
      sub: note('2 天后'),
      progress: null,
      action: { label: '查看', variant: 'ghost', href: HOMEWORK_HREF },
      done: false,
    });
  });

  it('says an upcoming exam starts', async () => {
    const view = await viewOf(upcomingRow({
      kind: 'exam',
      flavor: 'paper',
      title: '操作系统期中考试',
      durationMinutes: 100,
    }));
    expectRow(view, {
      typeLabel: PAPER,
      meta: contestMeta(20, ['个人限时 100 分钟']),
      time: textTime('10/20 14:00 开始'),
      sub: note('2 天后'),
      progress: null,
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: false,
    });
  });

  it('offers registration for an upcoming individual contest', async () => {
    const view = await viewOf(upcomingRow({
      kind: 'exam',
      flavor: 'acm',
      title: '秋季校赛',
      problemCount: 5,
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(5),
      time: textTime('10/20 14:00 开始'),
      sub: note('2 天后'),
      progress: null,
      action: { label: '报名', variant: 'soft', href: EXAM_HREF },
      done: false,
    });
  });

  it('shows that an upcoming contest is already registered', async () => {
    const view = await viewOf(upcomingRow({
      kind: 'exam',
      flavor: 'oi',
      title: '普及组校赛',
      problemCount: 4,
      attended: true,
    }));
    expectRow(view, {
      typeLabel: OI,
      meta: contestMeta(4),
      time: textTime('10/20 14:00 开始'),
      sub: note('2 天后'),
      progress: meter('已报名'),
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: false,
    });
  });

  it('keeps a view action for an upcoming team contest', async () => {
    const view = await viewOf(upcomingRow({
      kind: 'exam',
      flavor: 'acm',
      title: '秋季校赛',
      problemCount: 5,
      team: true,
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(5, ['团队赛']),
      time: textTime('10/20 14:00 开始'),
      sub: note('2 天后'),
      progress: null,
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: false,
    });
  });

  it('keeps a view action for an upcoming contest that requires the client', async () => {
    const view = await viewOf(upcomingRow({
      kind: 'exam',
      flavor: 'ioi',
      title: '期末上机',
      problemCount: 4,
      clientRequired: true,
    }));
    expectRow(view, {
      typeLabel: IOI,
      meta: contestMeta(4, ['机房客户端考试']),
      time: textTime('10/20 14:00 开始'),
      sub: note('2 天后'),
      progress: null,
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: false,
    });
  });

  it('appends the personal limit, team, and client phrases to the meta line', async () => {
    const view = await viewOf(upcomingRow({
      kind: 'exam',
      flavor: 'acm',
      title: '秋季校赛',
      problemCount: 5,
      durationMinutes: 45,
      team: true,
      clientRequired: true,
    }));
    expectRow(view, {
      typeLabel: ACM,
      meta: contestMeta(5, ['个人限时 45 分钟', '团队赛', '机房客户端考试']),
      time: textTime('10/20 14:00 开始'),
      sub: note('2 天后'),
      progress: null,
      action: { label: '查看', variant: 'ghost', href: EXAM_HREF },
      done: false,
    });
  });
});
