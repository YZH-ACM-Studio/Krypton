// @vitest-environment node
// Same loader as model.spec.ts: a named import fails collection until C4 exports exist.
import { describe, expect, it } from 'vitest';

const modelLoaders = import.meta.glob('../../src/pages/problem-sets/model.ts');
const MODEL_SOURCE = 'src/pages/problem-sets/model.ts';

const FROM = '2026-10-19T00:00:00+08:00';
const TO = '2026-10-26T00:00:00.000Z';
const EXAM_HREF = '/contest/64b8000000000000000000a1';
const HOMEWORK_HREF = '/homework/64b8000000000000000000a2';
const PRACTICE_HREF = '/problem-sets/64b8000000000000000000b1';
const TEAM_HREF = '/teams/batch-1';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SAMPLE_WEDNESDAY_MS = Date.parse('2026-10-21T06:32:00Z');
const SAMPLE_MONDAY_MS = Date.parse('2026-10-18T16:00:00Z');

type ContestFlavor = 'paper' | 'acm' | 'ioi' | 'oi' | 'homework';

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

interface StudentCalendar {
  from: string;
  to: string;
  rows: ContestRow[];
}

interface CalendarModel {
  parseStudentCalendar: (raw: unknown) => StudentCalendar;
  schoolWeekStart: (nowMs: number) => number;
  studentCalendarUrl: (fromMs: number, toMs: number) => string;
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

async function loadModel(): Promise<CalendarModel> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(modelLoaders)) {
    if (key.endsWith(MODEL_SOURCE)) load = candidate;
  }
  expect(typeof load, `${MODEL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${MODEL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${MODEL_SOURCE} must be a module`);
  return {
    parseStudentCalendar: asFunction<CalendarModel['parseStudentCalendar']>(readField(imported, 'parseStudentCalendar'), 'parseStudentCalendar'),
    schoolWeekStart: asFunction<CalendarModel['schoolWeekStart']>(readField(imported, 'schoolWeekStart'), 'schoolWeekStart'),
    studentCalendarUrl: asFunction<CalendarModel['studentCalendarUrl']>(readField(imported, 'studentCalendarUrl'), 'studentCalendarUrl'),
  };
}

function contestRow(overrides: Partial<ContestRow> & Pick<ContestRow, 'kind' | 'flavor'>): ContestRow {
  return {
    id: '64b8000000000000000000a1',
    title: '数据结构期中考试',
    href: EXAM_HREF,
    beginAt: '2026-10-23T11:00:00+08:00',
    endAt: '2026-10-23T13:00:00+08:00',
    dueAt: null,
    durationMinutes: 120,
    startAt: '2026-10-23T11:05:00+08:00',
    personalEndAt: null,
    attended: true,
    clientRequired: true,
    team: false,
    problemCount: 20,
    progress: null,
    finalized: false,
    done: false,
    ...overrides,
  };
}

function examRow(): ContestRow {
  return contestRow({ kind: 'exam', flavor: 'paper' });
}

function homeworkRow(): ContestRow {
  return contestRow({
    kind: 'homework',
    flavor: 'homework',
    id: '64b8000000000000000000a2',
    title: '第 3 章 循环结构',
    href: HOMEWORK_HREF,
    beginAt: '2026-10-14T00:00:00+08:00',
    endAt: '2026-10-22T15:59:00.000Z',
    dueAt: '2026-10-22T15:59:00.000Z',
    durationMinutes: null,
    startAt: null,
    personalEndAt: '2026-10-22T07:00:00+08:00',
    attended: true,
    clientRequired: false,
    problemCount: 12,
    progress: { answered: 8 },
    finalized: true,
    done: true,
  });
}

function practiceRow(): Record<string, unknown> {
  return {
    kind: 'practice',
    description: '练习简介',
    enrolled: true,
    participantCount: 12,
    sourceLabels: ['课程'],
    stages: [{ id: 1, title: '阶段一', status: 'open' as const }],
    id: '64b8000000000000000000b1',
    title: 'PAT 甲级训练集',
    href: PRACTICE_HREF,
    stageCount: 3,
    problemCount: 120,
    doneCount: 0,
    sourceLabel: '全站公开',
  };
}

function teamRow(): Record<string, unknown> {
  return {
    kind: 'team',
    id: 'batch-1',
    title: '2026 秋季校赛组队',
    href: TEAM_HREF,
    description: '',
    myState: 'none',
    inviteCount: 0,
    memberCount: null,
  };
}

function calendarBody(rows: unknown): Record<string, unknown> {
  return {
    view: 'calendar',
    from: FROM,
    to: TO,
    rows,
  };
}

describe('student calendar model', () => {
  it('parses a calendar body into the same two contest rows', async () => {
    const model = await loadModel();
    const exam = examRow();
    const homework = homeworkRow();
    const parsed = model.parseStudentCalendar(calendarBody([exam, homework]));
    expect(parsed.from).toBe(FROM);
    expect(parsed.to).toBe(TO);
    expect(parsed.rows).toEqual([exam, homework]);
  });

  it('throws when the payload is not an object', async () => {
    const model = await loadModel();
    expect(() => model.parseStudentCalendar(null)).toThrow(TypeError);
    expect(() => model.parseStudentCalendar('calendar')).toThrow(TypeError);
  });

  it('throws when view is missing', async () => {
    const model = await loadModel();
    const { view: _view, ...rest } = calendarBody([examRow(), homeworkRow()]);
    expect(() => model.parseStudentCalendar(rest)).toThrow(TypeError);
  });

  it('throws when view is not calendar', async () => {
    const model = await loadModel();
    expect(() => model.parseStudentCalendar({ ...calendarBody([examRow()]), view: 'list' })).toThrow(TypeError);
  });

  it('throws when rows is not an array', async () => {
    const model = await loadModel();
    expect(() => model.parseStudentCalendar(calendarBody({}))).toThrow(TypeError);
  });

  it('throws when a row is a practice', async () => {
    const model = await loadModel();
    expect(() => model.parseStudentCalendar(calendarBody([examRow(), practiceRow()]))).toThrow(TypeError);
  });

  it('throws when a row is a team', async () => {
    const model = await loadModel();
    expect(() => model.parseStudentCalendar(calendarBody([homeworkRow(), teamRow()]))).toThrow(TypeError);
  });

  it('throws when from or to is not a string', async () => {
    const model = await loadModel();
    const { from: _from, ...missingFrom } = calendarBody([examRow()]);
    expect(() => model.parseStudentCalendar(missingFrom)).toThrow(TypeError);
    expect(() => model.parseStudentCalendar({ ...calendarBody([examRow()]), from: SAMPLE_MONDAY_MS })).toThrow(TypeError);
    expect(() => model.parseStudentCalendar({ ...calendarBody([examRow()]), to: null })).toThrow(TypeError);
  });

  it('throws when a contest row is missing a required field', async () => {
    const model = await loadModel();
    const broken: Record<string, unknown> = { ...examRow() };
    delete broken.title;
    expect(() => model.parseStudentCalendar(calendarBody([broken]))).toThrow(TypeError);
  });

  it('maps beijing wednesday afternoon to monday midnight', async () => {
    const model = await loadModel();
    expect(model.schoolWeekStart(SAMPLE_WEDNESDAY_MS)).toBe(SAMPLE_MONDAY_MS);
    expect(SAMPLE_WEDNESDAY_MS).toBe(Date.parse('2026-10-21T06:32:00Z'));
    expect(SAMPLE_MONDAY_MS).toBe(Date.parse('2026-10-18T16:00:00Z'));
  });

  it('maps beijing sunday 23:59 to that week monday', async () => {
    const model = await loadModel();
    expect(model.schoolWeekStart(Date.parse('2026-10-25T23:59:00+08:00'))).toBe(Date.parse('2026-10-19T00:00:00+08:00'));
    expect(model.schoolWeekStart(Date.parse('2026-11-08T23:59:00+08:00'))).toBe(Date.parse('2026-11-02T00:00:00+08:00'));
  });

  it('maps beijing monday 00:00 to that same instant', async () => {
    const model = await loadModel();
    const monday = Date.parse('2026-10-19T00:00:00+08:00');
    const laterMonday = Date.parse('2026-11-02T00:00:00+08:00');
    expect(model.schoolWeekStart(monday)).toBe(monday);
    expect(model.schoolWeekStart(laterMonday)).toBe(laterMonday);
    expect(monday).toBe(SAMPLE_MONDAY_MS);
  });

  it('builds a calendar url from epoch milliseconds', async () => {
    const fromMs = SAMPLE_MONDAY_MS;
    const toMs = SAMPLE_MONDAY_MS + WEEK_MS;
    const params = new URLSearchParams();
    params.set('view', 'calendar');
    params.set('from', new Date(fromMs).toISOString());
    params.set('to', new Date(toMs).toISOString());
    const expected = `/problem-sets?${params.toString()}`;
    expect(expected).toBe(
      '/problem-sets?view=calendar&from=2026-10-18T16%3A00%3A00.000Z&to=2026-10-25T16%3A00%3A00.000Z',
    );
    const model = await loadModel();
    expect(model.studentCalendarUrl(fromMs, toMs)).toBe(expected);
  });

  it('maps the other beijing weekdays onto that week monday', async () => {
    const model = await loadModel();
    const monday = Date.parse('2026-10-19T00:00:00+08:00');
    const instants = [
      '2026-10-20T15:00:00+08:00',
      '2026-10-22T08:00:00+08:00',
      '2026-10-23T23:00:00+08:00',
      '2026-10-24T12:00:00+08:00',
    ];
    for (const iso of instants) {
      expect(model.schoolWeekStart(Date.parse(iso))).toBe(monday);
    }
  });

  it('maps the millisecond before beijing monday to the previous week', async () => {
    const model = await loadModel();
    const monday = Date.parse('2026-10-19T00:00:00+08:00');
    expect(model.schoolWeekStart(monday - 1)).toBe(Date.parse('2026-10-12T00:00:00+08:00'));
  });

  it('throws when now is not a finite timestamp', async () => {
    const model = await loadModel();
    expect(() => model.schoolWeekStart(Number.NaN)).toThrow(TypeError);
    expect(() => model.schoolWeekStart(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => model.schoolWeekStart(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });

  it('throws when a calendar bound is not a finite timestamp', async () => {
    const model = await loadModel();
    const toMs = SAMPLE_MONDAY_MS + WEEK_MS;
    expect(() => model.studentCalendarUrl(Number.NaN, toMs)).toThrow(TypeError);
    expect(() => model.studentCalendarUrl(SAMPLE_MONDAY_MS, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('throws when view is not exactly calendar', async () => {
    const model = await loadModel();
    expect(() => model.parseStudentCalendar({ ...calendarBody([examRow()]), view: 'Calendar' })).toThrow(TypeError);
    expect(() => model.parseStudentCalendar({ ...calendarBody([examRow()]), view: 'CALENDAR' })).toThrow(TypeError);
  });

  it('throws when the calendar payload is an array', async () => {
    const model = await loadModel();
    const listed: object = [];
    Object.assign(listed, calendarBody([examRow()]));
    expect(() => model.parseStudentCalendar(listed)).toThrow(TypeError);
  });
});
