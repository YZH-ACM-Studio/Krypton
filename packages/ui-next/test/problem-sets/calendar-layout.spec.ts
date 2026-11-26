// @vitest-environment node
// A named import fails collection until calendar-layout.ts exists.
import { describe, expect, it } from 'vitest';
import type { ContestRow } from '../../src/pages/problem-sets/model.ts';

process.env.TZ = 'Asia/Shanghai';

const layoutLoaders = import.meta.glob('../../src/pages/problem-sets/calendar-layout.ts');
const LAYOUT_SOURCE = 'src/pages/problem-sets/calendar-layout.ts';

const NOW = Date.parse('2026-10-21T14:32:00+08:00');
const WEEK_START = Date.parse('2026-10-19T00:00:00+08:00');
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DOT = '\u00B7';
const EN = '\u2013';

type CalendarState = 'run' | 'soon' | 'up' | 'end';

interface WeekBar {
  row: ContestRow;
  state: CalendarState;
  kind: 'bar' | 'point';
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  label: string;
}

interface MonthEvent {
  row: ContestRow;
  kind: 'start' | 'due' | 'point';
  label: string;
  done: boolean;
  soon: boolean;
}

interface MonthCell {
  dayMs: number;
  inMonth: boolean;
  today: boolean;
  events: MonthEvent[];
}

interface MonthGrid {
  cells: MonthCell[];
  fromMs: number;
  toMs: number;
  title: string;
}

interface AgendaItem {
  row: ContestRow;
  what: '截止' | '开始' | '考试';
  timeLabel: string;
}

interface AgendaGroup {
  key: string;
  title: string;
  subtitle: string;
  items: AgendaItem[];
}

interface CalendarHeadline {
  count: number;
  remaining: number | null;
  caption: string;
  relative: string;
  range: string | null;
}

interface CalendarLayout {
  calendarState: (row: ContestRow, nowMs: number) => CalendarState;
  isPointEvent: (row: ContestRow) => boolean;
  weekBars: (rows: readonly ContestRow[], weekStartMs: number, nowMs: number) => WeekBar[];
  monthGrid: (rows: readonly ContestRow[], monthOffset: number, nowMs: number) => MonthGrid;
  weekAgenda: (rows: readonly ContestRow[], weekStartMs: number, nowMs: number) => AgendaGroup[];
  calendarHeadline: (
    rows: readonly ContestRow[],
    mode: 'week' | 'month',
    offset: number,
    fromMs: number,
    toMs: number,
    nowMs: number,
  ) => CalendarHeadline;
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

async function loadLayout(): Promise<CalendarLayout> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(layoutLoaders)) {
    if (key.endsWith(LAYOUT_SOURCE)) load = candidate;
  }
  expect(typeof load, `${LAYOUT_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${LAYOUT_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${LAYOUT_SOURCE} must be a module`);
  return {
    calendarState: asFunction<CalendarLayout['calendarState']>(readField(imported, 'calendarState'), 'calendarState'),
    isPointEvent: asFunction<CalendarLayout['isPointEvent']>(readField(imported, 'isPointEvent'), 'isPointEvent'),
    weekBars: asFunction<CalendarLayout['weekBars']>(readField(imported, 'weekBars'), 'weekBars'),
    monthGrid: asFunction<CalendarLayout['monthGrid']>(readField(imported, 'monthGrid'), 'monthGrid'),
    weekAgenda: asFunction<CalendarLayout['weekAgenda']>(readField(imported, 'weekAgenda'), 'weekAgenda'),
    calendarHeadline: asFunction<CalendarLayout['calendarHeadline']>(readField(imported, 'calendarHeadline'), 'calendarHeadline'),
  };
}

function row(fields: Partial<ContestRow> & Pick<ContestRow, 'id' | 'kind' | 'title' | 'beginAt' | 'endAt'>): ContestRow {
  return {
    flavor: fields.kind === 'homework' ? 'homework' : 'paper',
    href: fields.kind === 'homework' ? `/homework/${fields.id}` : `/contest/${fields.id}`,
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: false,
    clientRequired: false,
    team: false,
    problemCount: 1,
    progress: null,
    finalized: false,
    done: false,
    ...fields,
  };
}

function at(iso: string): number {
  return Date.parse(iso);
}

function beijingMidnight(day: string): number {
  return Date.parse(`${day}T00:00:00+08:00`);
}

const chapter1 = row({
  id: 'h1',
  kind: 'homework',
  title: '第一章 程序入门',
  beginAt: '2026-09-28T08:00:00+08:00',
  endAt: '2026-10-12T23:59:00+08:00',
  done: true,
});

const quiz1 = row({
  id: 'q1',
  kind: 'exam',
  flavor: 'paper',
  title: '第一单元小测',
  beginAt: '2026-10-13T19:00:00+08:00',
  endAt: '2026-10-13T20:00:00+08:00',
  done: true,
});

const chapter3 = row({
  id: 'h3',
  kind: 'homework',
  title: '第三章 循环结构',
  beginAt: '2026-10-14T08:00:00+08:00',
  endAt: '2026-10-22T12:00:00+08:00',
  dueAt: '2026-10-30T23:59:00+08:00',
  personalEndAt: '2026-10-30T23:59:00+08:00',
  done: false,
});

const chapter2 = row({
  id: 'h2',
  kind: 'homework',
  title: '第二章 分支结构',
  beginAt: '2026-10-07T08:00:00+08:00',
  endAt: '2026-10-19T23:59:00+08:00',
  done: true,
});

const contest6 = row({
  id: 'o6',
  kind: 'exam',
  flavor: 'oi',
  title: '周赛 #6',
  beginAt: '2026-10-19T19:00:00+08:00',
  endAt: '2026-10-19T21:00:00+08:00',
  done: true,
});

const chapter4 = row({
  id: 'h4',
  kind: 'homework',
  title: '第四章 数组',
  beginAt: '2026-10-20T08:00:00+08:00',
  endAt: '2026-10-29T23:59:00+08:00',
  done: false,
});

const doneOpen = row({
  id: 'done-open',
  kind: 'homework',
  title: '已完成仍开放',
  beginAt: '2026-10-20T10:00:00+08:00',
  endAt: '2026-10-28T18:00:00+08:00',
  done: true,
});

const midterm = row({
  id: 'p1',
  kind: 'exam',
  flavor: 'paper',
  title: '期中测验',
  beginAt: '2026-10-23T19:00:00+08:00',
  endAt: '2026-10-23T21:00:00+08:00',
  done: false,
});

const saturdayStart = row({
  id: 'sat',
  kind: 'homework',
  title: '周六实验',
  beginAt: '2026-10-24T09:00:00+08:00',
  endAt: '2026-11-02T18:00:00+08:00',
  done: false,
});

const warmup = row({
  id: 'a1',
  kind: 'exam',
  flavor: 'acm',
  title: '校赛热身赛',
  beginAt: '2026-10-25T13:00:00+08:00',
  endAt: '2026-10-25T17:00:00+08:00',
  done: false,
});

const week7 = row({
  id: 'o7',
  kind: 'exam',
  flavor: 'oi',
  title: '周赛 #7',
  beginAt: '2026-10-26T19:00:00+08:00',
  endAt: '2026-10-26T21:00:00+08:00',
  done: false,
});

const chapter5 = row({
  id: 'h5',
  kind: 'homework',
  title: '第五章 函数',
  beginAt: '2026-10-27T08:00:00+08:00',
  endAt: '2026-11-05T23:59:00+08:00',
  done: false,
});

const finalMock = row({
  id: 'm1',
  kind: 'exam',
  flavor: 'paper',
  title: '期末模拟',
  beginAt: '2026-11-01T09:00:00+08:00',
  endAt: '2026-11-01T11:00:00+08:00',
  done: false,
});

const wednesdayExam = row({
  id: 'wed',
  kind: 'exam',
  flavor: 'paper',
  title: '周三测验',
  beginAt: '2026-10-21T19:00:00+08:00',
  endAt: '2026-10-21T21:00:00+08:00',
  done: false,
});

function sampleRows(): ContestRow[] {
  return [
    chapter4,
    chapter1,
    week7,
    chapter3,
    finalMock,
    chapter2,
    midterm,
    chapter5,
    contest6,
    warmup,
    quiz1,
    doneOpen,
    saturdayStart,
  ];
}

function barNamed(bars: WeekBar[], title: string): WeekBar {
  const found = bars.find((bar) => bar.row.title === title);
  expect(found, title).toBeTruthy();
  if (!found) throw new Error(title);
  return found;
}

function cellOn(cells: MonthCell[], day: string): MonthCell {
  const found = cells.find((cell) => cell.dayMs === beijingMidnight(day));
  expect(found, day).toBeTruthy();
  if (!found) throw new Error(day);
  return found;
}

function eventsNamed(cell: MonthCell, title: string): MonthEvent[] {
  return cell.events.filter((event) => event.row.title === title);
}

describe('calendar state', () => {
  it('classifies the sample rows from endAt, not the personal deadline', async () => {
    const layout = await loadLayout();
    expect(layout.calendarState(chapter3, NOW)).toBe('soon');
    expect(layout.calendarState(chapter4, NOW)).toBe('run');
    expect(layout.calendarState(midterm, NOW)).toBe('up');
    expect(layout.calendarState(chapter2, NOW)).toBe('end');
    expect(layout.calendarState(doneOpen, NOW)).toBe('run');
  });

  it('treats an exact deadline as ended and an exact 24 hour gap as soon', async () => {
    const layout = await loadLayout();
    const open = row({
      id: 'boundary',
      kind: 'homework',
      title: '边界',
      beginAt: new Date(NOW - DAY_MS).toISOString(),
      endAt: new Date(NOW).toISOString(),
    });
    expect(layout.calendarState(open, NOW)).toBe('end');
    expect(layout.calendarState({ ...open, endAt: new Date(NOW + 1).toISOString() }, NOW)).toBe('soon');
    expect(layout.calendarState({ ...open, endAt: new Date(NOW + DAY_MS).toISOString() }, NOW)).toBe('soon');
    expect(layout.calendarState({ ...open, endAt: new Date(NOW + DAY_MS + 1).toISOString() }, NOW)).toBe('run');
    expect(layout.calendarState({
      ...open,
      beginAt: new Date(NOW).toISOString(),
      endAt: new Date(NOW + 2 * DAY_MS).toISOString(),
    }, NOW)).toBe('run');
    expect(layout.calendarState({
      ...open,
      beginAt: new Date(NOW + 1).toISOString(),
      endAt: new Date(NOW + 2 * DAY_MS).toISOString(),
    }, NOW)).toBe('up');
  });
});

describe('point events', () => {
  it('counts a same beijing day of at most six hours, including the exact limit', async () => {
    const layout = await loadLayout();
    expect(layout.isPointEvent(midterm)).toBe(true);
    expect(layout.isPointEvent(warmup)).toBe(true);
    expect(layout.isPointEvent(chapter3)).toBe(false);
    expect(layout.isPointEvent(row({
      id: 'six',
      kind: 'exam',
      title: '正好六小时',
      beginAt: '2026-10-23T13:00:00+08:00',
      endAt: '2026-10-23T19:00:00+08:00',
    }))).toBe(true);
    expect(layout.isPointEvent(row({
      id: 'six-plus',
      kind: 'exam',
      title: '超过六小时',
      beginAt: '2026-10-23T13:00:00+08:00',
      endAt: '2026-10-23T19:00:00.001+08:00',
    }))).toBe(false);
    expect(layout.isPointEvent(row({
      id: 'long-day',
      kind: 'homework',
      title: '同一天十小时',
      beginAt: '2026-10-23T08:00:00+08:00',
      endAt: '2026-10-23T18:00:00+08:00',
    }))).toBe(false);
  });

  it('uses the beijing calendar day when utc midnight falls inside it', async () => {
    const layout = await loadLayout();
    expect(layout.isPointEvent(row({
      id: 'utc-split',
      kind: 'exam',
      title: '北京同一天',
      beginAt: '2026-10-23T07:30:00+08:00',
      endAt: '2026-10-23T09:30:00+08:00',
    }))).toBe(true);
    expect(layout.isPointEvent(row({
      id: 'bj-split',
      kind: 'exam',
      title: '跨过北京零点',
      beginAt: '2026-10-23T23:00:00+08:00',
      endAt: '2026-10-24T01:00:00+08:00',
    }))).toBe(false);
  });
});

describe('week bars', () => {
  it('places chapter three as a soon bar clipped at the week start', async () => {
    const layout = await loadLayout();
    const bars = layout.weekBars(sampleRows(), WEEK_START, NOW);
    const bar = barNamed(bars, chapter3.title);
    expect(bar.state).toBe('soon');
    expect(bar.kind).toBe('bar');
    expect(bar.clippedStart).toBe(true);
    expect(bar.clippedEnd).toBe(false);
    expect(bar.left).toBe(0);
    expect(bar.width).toBeCloseTo(0.5, 8);
    expect(bar.label).toBe('截止 周四 12:00');
    expect(bar.row).toEqual(chapter3);
  });

  it('places chapter four as a running bar clipped at the week end', async () => {
    const layout = await loadLayout();
    const bar = barNamed(layout.weekBars(sampleRows(), WEEK_START, NOW), chapter4.title);
    expect(bar.state).toBe('run');
    expect(bar.kind).toBe('bar');
    expect(bar.clippedStart).toBe(false);
    expect(bar.clippedEnd).toBe(true);
    expect(bar.left).toBeCloseTo(32 / 168, 8);
    expect(bar.width).toBeCloseTo(1 - 32 / 168, 8);
    expect(bar.label).toBe('截止 10月29日 23:59');
  });

  it('draws the friday paper exam as an upcoming point', async () => {
    const layout = await loadLayout();
    const bars = layout.weekBars(sampleRows(), WEEK_START, NOW);
    expect(layout.isPointEvent(midterm)).toBe(true);
    const bar = barNamed(bars, midterm.title);
    expect(bar.kind).toBe('point');
    expect(bar.state).toBe('up');
    expect(bar.width).toBe(0);
    expect(bar.clippedStart).toBe(false);
    expect(bar.clippedEnd).toBe(false);
    expect(bar.left).toBeCloseTo(115 / 168, 8);
    expect(bar.label).toBe(`19:00 ${DOT} 2 小时`);
  });

  it('marks the ended homework and drops rows that start after sunday', async () => {
    const layout = await loadLayout();
    const bars = layout.weekBars(sampleRows(), WEEK_START, NOW);
    expect(bars.map((bar) => bar.row.title)).toEqual([
      '第二章 分支结构',
      '第三章 循环结构',
      '周赛 #6',
      '第四章 数组',
      '已完成仍开放',
      '期中测验',
      '周六实验',
      '校赛热身赛',
    ]);
    const ended = barNamed(bars, chapter2.title);
    expect(ended.state).toBe('end');
    expect(ended.kind).toBe('bar');
    expect(ended.clippedStart).toBe(true);
    expect(ended.clippedEnd).toBe(false);
    expect(ended.left).toBe(0);
    expect(ended.label).toBe('已截止');
    const endedPoint = barNamed(bars, contest6.title);
    expect(endedPoint.kind).toBe('point');
    expect(endedPoint.state).toBe('end');
    expect(endedPoint.width).toBe(0);
    expect(endedPoint.label).toBe(`19:00 ${DOT} 2 小时`);
    const notStarted = barNamed(bars, saturdayStart.title);
    expect(notStarted.state).toBe('up');
    expect(notStarted.kind).toBe('bar');
    expect(notStarted.clippedEnd).toBe(true);
    expect(notStarted.label).toBe('周六 09:00 开始');
    const stillOpen = barNamed(bars, doneOpen.title);
    expect(stillOpen.state).toBe('run');
    expect(stillOpen.label).toBe('截止 10月28日 18:00');
    expect(barNamed(bars, warmup.title).label).toBe(`13:00 ${DOT} 4 小时`);
    expect(bars.map((bar) => bar.row.title)).not.toContain('周赛 #7');
    expect(bars.map((bar) => bar.row.title)).not.toContain('第五章 函数');
    expect(bars.map((bar) => bar.row.title)).not.toContain('期末模拟');
  });

  it('keeps a bar that ends on the next monday midnight and drops a zero-width touch', async () => {
    const layout = await loadLayout();
    const endsAtOpen = row({
      id: 'touch-open',
      kind: 'homework',
      title: '刚好在本周开始时截止',
      beginAt: '2026-10-18T22:00:00+08:00',
      endAt: '2026-10-19T00:00:00+08:00',
    });
    const endsAtClose = row({
      id: 'touch-close',
      kind: 'homework',
      title: '刚好在本周结束时截止',
      beginAt: '2026-10-25T22:00:00+08:00',
      endAt: '2026-10-26T00:00:00+08:00',
    });
    const startsAtClose = row({
      id: 'next-open',
      kind: 'exam',
      title: '刚好在本周结束后开始',
      beginAt: '2026-10-26T00:00:00+08:00',
      endAt: '2026-10-26T02:00:00+08:00',
    });
    const bars = layout.weekBars([endsAtOpen, startsAtClose, endsAtClose], WEEK_START, NOW);
    expect(bars.map((bar) => bar.row.title)).toEqual(['刚好在本周结束时截止']);
    expect(bars[0]?.kind).toBe('bar');
    expect(bars[0]?.state).toBe('up');
    expect(bars[0]?.clippedStart).toBe(false);
    expect(bars[0]?.clippedEnd).toBe(false);
    expect(bars[0]?.label).toBe('周日 22:00 开始');
    expect(layout.weekBars([], WEEK_START, NOW)).toEqual([]);
  });

  it('does not clip a bar that opens at monday midnight', async () => {
    const layout = await loadLayout();
    const edge = row({
      id: 'open-monday',
      kind: 'homework',
      title: '周一零点开放',
      beginAt: '2026-10-19T00:00:00+08:00',
      endAt: '2026-10-22T12:00:00+08:00',
      done: false,
    });
    const bar = barNamed(layout.weekBars([edge], WEEK_START, NOW), edge.title);
    expect(bar.clippedStart).toBe(false);
    expect(bar.clippedEnd).toBe(false);
    expect(bar.left).toBe(0);
  });

  it('uses the date when a running bar ends on the next monday midnight', async () => {
    const layout = await loadLayout();
    const edge = row({
      id: 'label-week-end',
      kind: 'homework',
      title: '下周一零点截止',
      beginAt: '2026-10-20T08:00:00+08:00',
      endAt: '2026-10-26T00:00:00+08:00',
      done: false,
    });
    const bar = barNamed(layout.weekBars([edge], WEEK_START, NOW), edge.title);
    expect(bar.state).toBe('run');
    expect(bar.kind).toBe('bar');
    expect(bar.clippedEnd).toBe(false);
    expect(bar.label).toBe('截止 10月26日 00:00');
  });
});

describe('calendar headline', () => {
  it('counts five deadlines this week and three still unfinished', async () => {
    const layout = await loadLayout();
    const headline = layout.calendarHeadline(
      sampleRows(),
      'week',
      0,
      WEEK_START,
      WEEK_START + WEEK_MS,
      NOW,
    );
    expect(headline).toEqual({
      count: 5,
      remaining: 3,
      caption: '项在本周截止',
      relative: '本周',
      range: `10月19日 ${EN} 10月25日`,
    });
  });

  it('names the next week, the previous week, and a three week gap', async () => {
    const layout = await loadLayout();
    const rows = sampleRows();
    expect(layout.calendarHeadline(rows, 'week', 1, WEEK_START + WEEK_MS, WEEK_START + 2 * WEEK_MS, NOW)).toEqual({
      count: 4,
      remaining: null,
      caption: '项在这周截止',
      relative: '下周',
      range: `10月26日 ${EN} 11月1日`,
    });
    expect(layout.calendarHeadline(rows, 'week', -1, WEEK_START - WEEK_MS, WEEK_START, NOW)).toEqual({
      count: 2,
      remaining: null,
      caption: '项在这周截止',
      relative: '上周',
      range: `10月12日 ${EN} 10月18日`,
    });
    expect(layout.calendarHeadline(rows, 'week', -3, WEEK_START - 3 * WEEK_MS, WEEK_START - 2 * WEEK_MS, NOW)).toEqual({
      count: 0,
      remaining: null,
      caption: '项在这周截止',
      relative: '3 周前',
      range: `9月28日 ${EN} 10月4日`,
    });
    expect(layout.calendarHeadline(rows, 'week', 2, WEEK_START + 2 * WEEK_MS, WEEK_START + 3 * WEEK_MS, NOW)).toEqual({
      count: 2,
      remaining: null,
      caption: '项在这周截止',
      relative: '2 周后',
      range: `11月2日 ${EN} 11月8日`,
    });
  });

  it('counts a calendar month separately from a week and hides the range', async () => {
    const layout = await loadLayout();
    const october = layout.calendarHeadline(
      sampleRows(),
      'month',
      0,
      beijingMidnight('2026-10-01'),
      beijingMidnight('2026-11-01'),
      NOW,
    );
    expect(october).toEqual({
      count: 10,
      remaining: 5,
      caption: '项在本月截止',
      relative: '本月',
      range: null,
    });
    const november = layout.calendarHeadline(
      sampleRows(),
      'month',
      1,
      beijingMidnight('2026-11-01'),
      beijingMidnight('2026-12-01'),
      NOW,
    );
    expect(november).toEqual({
      count: 3,
      remaining: null,
      caption: '项在这个月截止',
      relative: '2026 年 11 月',
      range: null,
    });
    const september = layout.calendarHeadline(
      [],
      'month',
      -1,
      beijingMidnight('2026-09-01'),
      beijingMidnight('2026-10-01'),
      NOW,
    );
    expect(september.caption).toBe('项在这个月截止');
    expect(september.relative).toBe('2026 年 9 月');
    expect(september.remaining).toBeNull();
    expect(september.range).toBeNull();
  });

  it('counts an end on the opening instant and ignores an end on the closing instant', async () => {
    const layout = await loadLayout();
    const endsAtOpen = row({
      id: 'edge-open',
      kind: 'homework',
      title: '周一零点截止',
      beginAt: '2026-10-18T18:00:00+08:00',
      endAt: '2026-10-19T00:00:00+08:00',
      done: false,
    });
    const endsAtClose = row({
      id: 'edge-close',
      kind: 'homework',
      title: '下周一零点截止',
      beginAt: '2026-10-25T20:00:00+08:00',
      endAt: '2026-10-26T00:00:00+08:00',
      done: false,
    });
    const headline = layout.calendarHeadline(
      [endsAtClose, endsAtOpen],
      'week',
      0,
      WEEK_START,
      WEEK_START + WEEK_MS,
      NOW,
    );
    expect(headline.count).toBe(1);
    expect(headline.remaining).toBe(0);
    const empty = layout.calendarHeadline([], 'week', 0, WEEK_START, WEEK_START + WEEK_MS, NOW);
    expect(empty.count).toBe(0);
    expect(empty.remaining).toBe(0);
    expect(empty.caption).toBe('项在本周截止');
  });

  it('leaves a deadline at the current instant out of the remaining count', async () => {
    const layout = await loadLayout();
    const edge = row({
      id: 'ends-now',
      kind: 'homework',
      title: '此刻截止',
      beginAt: '2026-10-20T08:00:00+08:00',
      endAt: new Date(NOW).toISOString(),
      done: false,
    });
    const headline = layout.calendarHeadline(
      [edge],
      'week',
      0,
      WEEK_START,
      WEEK_START + WEEK_MS,
      NOW,
    );
    expect(headline.count).toBe(1);
    expect(headline.remaining).toBe(0);
    expect(layout.calendarState(edge, NOW)).toBe('end');
  });
});

describe('month grid', () => {
  it('builds 35 monday-first cells for october 2026 and marks the 21st today', async () => {
    const layout = await loadLayout();
    const grid = layout.monthGrid(sampleRows(), 0, NOW);
    expect(grid.cells).toHaveLength(35);
    expect(grid.title).toBe('本月');
    expect(grid.fromMs).toBe(beijingMidnight('2026-09-28'));
    expect(grid.toMs).toBe(beijingMidnight('2026-11-02'));
    expect(grid.cells[0]?.dayMs).toBe(beijingMidnight('2026-09-28'));
    expect(grid.cells[0]?.inMonth).toBe(false);
    expect(grid.cells[0]?.today).toBe(false);
    expect(grid.cells[34]?.dayMs).toBe(beijingMidnight('2026-11-01'));
    expect(grid.cells[34]?.inMonth).toBe(false);
    expect(grid.cells.filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(grid.cells.filter((cell) => cell.today).map((cell) => cell.dayMs)).toEqual([
      beijingMidnight('2026-10-21'),
    ]);
    const today = cellOn(grid.cells, '2026-10-21');
    expect(today.inMonth).toBe(true);
    expect(today.today).toBe(true);
  });

  it('lists a homework on its start and due days and a point exam only once', async () => {
    const layout = await loadLayout();
    const grid = layout.monthGrid(sampleRows(), 0, NOW);
    const start = eventsNamed(cellOn(grid.cells, '2026-10-14'), chapter3.title);
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({
      kind: 'start',
      label: '开始 第三章 循环结构',
      done: false,
    });
    const due = eventsNamed(cellOn(grid.cells, '2026-10-22'), chapter3.title);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      kind: 'due',
      label: '截止 第三章 循环结构',
      done: false,
      soon: true,
    });
    expect(eventsNamed(cellOn(grid.cells, '2026-10-15'), chapter3.title)).toEqual([]);
    const endedDue = eventsNamed(cellOn(grid.cells, '2026-10-19'), chapter2.title);
    expect(endedDue).toHaveLength(1);
    expect(endedDue[0]).toMatchObject({ kind: 'due', done: true, soon: false });
    const outside = eventsNamed(cellOn(grid.cells, '2026-09-28'), chapter1.title);
    expect(outside).toHaveLength(1);
    expect(outside[0]).toMatchObject({ kind: 'start', label: '开始 第一章 程序入门', done: true, soon: false });

    const pointCells = grid.cells.filter((cell) => cell.events.some((event) => event.row.id === midterm.id));
    expect(pointCells).toHaveLength(1);
    expect(pointCells[0]?.dayMs).toBe(beijingMidnight('2026-10-23'));
    expect(pointCells[0]?.events.filter((event) => event.row.id === midterm.id)).toEqual([
      expect.objectContaining({
        kind: 'point',
        label: '19:00 期中测验',
        done: false,
        soon: false,
      }),
    ]);
    const runningDue = eventsNamed(cellOn(grid.cells, '2026-10-29'), chapter4.title);
    expect(runningDue[0]).toMatchObject({ kind: 'due', soon: false, done: false, label: '截止 第四章 数组' });
  });

  it('names november with 42 cells and keeps today on the beijing date before utc midnight', async () => {
    const layout = await loadLayout();
    const november = layout.monthGrid(sampleRows(), 1, NOW);
    expect(november.title).toBe('2026 年 11 月');
    expect(november.cells).toHaveLength(42);
    expect(november.fromMs).toBe(beijingMidnight('2026-10-26'));
    expect(november.toMs).toBe(beijingMidnight('2026-12-07'));
    expect(november.cells[0]?.inMonth).toBe(false);
    expect(november.cells.some((cell) => cell.today)).toBe(false);
    const nov1 = cellOn(november.cells, '2026-11-01');
    expect(nov1.inMonth).toBe(true);
    expect(nov1.today).toBe(false);
    expect(eventsNamed(nov1, finalMock.title)).toEqual([
      expect.objectContaining({ kind: 'point', label: '09:00 期末模拟', done: false, soon: false }),
    ]);
    const september = layout.monthGrid([], -1, NOW);
    expect(september.title).toBe('2026 年 9 月');
    expect(september.cells).toHaveLength(35);
    expect(september.cells[0]?.dayMs).toBe(beijingMidnight('2026-08-31'));
    expect(september.cells[0]?.inMonth).toBe(false);
    expect(september.cells.every((cell) => cell.events.length === 0)).toBe(true);

    const early = layout.monthGrid([], 0, at('2026-10-21T02:00:00+08:00'));
    expect(early.cells.filter((cell) => cell.today).map((cell) => cell.dayMs)).toEqual([
      beijingMidnight('2026-10-21'),
    ]);
  });
});

describe('week agenda', () => {
  it('puts two unfinished running rows first, then names the 21st today', async () => {
    const layout = await loadLayout();
    const groups = layout.weekAgenda([...sampleRows(), wednesdayExam], WEEK_START, NOW);
    expect(groups.map((group) => [group.title, group.subtitle])).toEqual([
      ['进行中', '2 项'],
      ['周一', '10月19日'],
      ['今天', '10月21日'],
      ['周四', '10月22日'],
      ['周五', '10月23日'],
      ['周六', '10月24日'],
      ['周日', '10月25日'],
    ]);
    const running = groups[0];
    expect(running?.key).toBe('running');
    // In-week deadline stays HH:mm; a deadline outside this week is M/D.
    expect(running?.items.map((item) => [item.row.title, item.what, item.timeLabel])).toEqual([
      ['第三章 循环结构', '截止', '12:00'],
      ['第四章 数组', '截止', '10/29'],
    ]);
    const titlesAfter = groups.slice(1).flatMap((group) => group.items.map((item) => item.row.title));
    expect(titlesAfter).toContain('第三章 循环结构');
    expect(titlesAfter).not.toContain('第四章 数组');
    expect(titlesAfter).not.toContain('已完成仍开放');

    const today = groups.find((group) => group.title === '今天');
    expect(today?.items.map((item) => [item.row.title, item.what, item.timeLabel])).toEqual([
      ['周三测验', '考试', '19:00'],
    ]);
    const monday = groups.find((group) => group.title === '周一');
    expect(monday?.items.map((item) => `${item.what} ${item.row.title}`).sort()).toEqual([
      '截止 第二章 分支结构',
      '考试 周赛 #6',
    ]);
    expect(monday?.items.find((item) => item.row.title === '周赛 #6')?.timeLabel).toBe('19:00');
    const saturday = groups.find((group) => group.title === '周六');
    expect(saturday?.items.map((item) => [item.what, item.timeLabel, item.row.title])).toEqual([
      ['开始', '09:00', '周六实验'],
    ]);
    expect(groups.some((group) => group.title === '周二')).toBe(false);
  });

  it('omits the running group when the week is not the current one', async () => {
    const layout = await loadLayout();
    const groups = layout.weekAgenda([...sampleRows(), wednesdayExam], WEEK_START + WEEK_MS, NOW);
    expect(groups.some((group) => group.key === 'running' || group.title === '进行中' || group.title === '今天')).toBe(false);
    const due = groups.find((group) => group.subtitle === '10月29日');
    expect(due?.title).toBe('周四');
    expect(due?.items.some((item) => item.row.title === '第四章 数组' && item.what === '截止')).toBe(true);
  });

  it('skips an empty running header when nothing is in progress', async () => {
    const layout = await loadLayout();
    const groups = layout.weekAgenda([wednesdayExam], WEEK_START, NOW);
    expect(groups.map((group) => group.title)).toEqual(['今天']);
    expect(layout.weekAgenda([], WEEK_START, NOW)).toEqual([]);
  });

  it('shows a deadline on the next monday midnight as a date', async () => {
    const layout = await loadLayout();
    const edge = row({
      id: 'agenda-week-end',
      kind: 'homework',
      title: '下周一零点仍开放',
      beginAt: '2026-10-20T08:00:00+08:00',
      endAt: '2026-10-26T00:00:00+08:00',
      done: false,
    });
    const groups = layout.weekAgenda([edge], WEEK_START, NOW);
    const running = groups.find((group) => group.key === 'running');
    expect(running?.items.map((item) => [item.what, item.timeLabel, item.row.title])).toEqual([
      ['截止', '10/26', '下周一零点仍开放'],
    ]);
  });

  it('omits the running group at the next monday midnight', async () => {
    const layout = await loadLayout();
    const edge = row({
      id: 'cross-week',
      kind: 'homework',
      title: '跨过周末仍开放',
      beginAt: '2026-10-20T08:00:00+08:00',
      endAt: '2026-10-28T18:00:00+08:00',
      done: false,
    });
    const groups = layout.weekAgenda([edge], WEEK_START, WEEK_START + WEEK_MS);
    expect(groups.some((group) => group.key === 'running' || group.title === '进行中')).toBe(false);
  });

  it('does not list a start that falls on the current instant', async () => {
    const layout = await loadLayout();
    const edge = row({
      id: 'starts-now',
      kind: 'homework',
      title: '此刻开始',
      beginAt: new Date(NOW).toISOString(),
      endAt: '2026-10-25T18:00:00+08:00',
      done: false,
    });
    const groups = layout.weekAgenda([edge], WEEK_START, NOW);
    const starts = groups.flatMap((group) => group.items).filter((item) => item.what === '开始');
    expect(starts).toEqual([]);
    const running = groups.find((group) => group.key === 'running');
    expect(running?.items.map((item) => item.row.title)).toEqual(['此刻开始']);
  });
});
