import { schoolWeekStart } from './model';
import type { ContestRow } from './model';

/** China Standard Time has no DST, so a fixed offset matches every ISO instant. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const POINT_LIMIT_MS = 6 * HOUR_MS;
const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export type CalendarState = 'run' | 'soon' | 'up' | 'end';

export interface WeekBar {
  row: ContestRow;
  state: CalendarState;
  kind: 'bar' | 'point';
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  label: string;
}

export interface MonthEvent {
  row: ContestRow;
  kind: 'start' | 'due' | 'point';
  label: string;
  done: boolean;
  soon: boolean;
}

export interface MonthCell {
  dayMs: number;
  inMonth: boolean;
  today: boolean;
  events: MonthEvent[];
}

export interface MonthGrid {
  cells: MonthCell[];
  fromMs: number;
  toMs: number;
  title: string;
}

export interface AgendaItem {
  row: ContestRow;
  what: '截止' | '开始' | '考试';
  timeLabel: string;
}

export interface AgendaGroup {
  key: string;
  title: string;
  subtitle: string;
  items: AgendaItem[];
}

export interface CalendarHeadline {
  count: number;
  remaining: number | null;
  caption: string;
  relative: string;
  range: string | null;
}

interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

interface Span {
  row: ContestRow;
  begin: number;
  end: number;
}

interface TimedAgendaItem extends AgendaItem {
  at: number;
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) invalid(`${label} must be a finite timestamp`);
  return value;
}

function requireInteger(value: number, label: string): number {
  if (!Number.isInteger(value)) invalid(`${label} must be an integer`);
  return value;
}

function parseInstant(iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) invalid(`invalid timestamp ${iso}`);
  return parsed;
}

function civil(instant: number): CivilTime {
  const shifted = new Date(requireFinite(instant, 'timestamp') + SHANGHAI_OFFSET_MS);
  const utcDay = shifted.getUTCDay();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: utcDay === 0 ? 6 : utcDay - 1,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clock(instant: number): string {
  const time = civil(instant);
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}

function monthDay(instant: number): string {
  const time = civil(instant);
  return `${time.month}月${time.day}日`;
}

function slashDay(instant: number): string {
  const time = civil(instant);
  return `${time.month}/${time.day}`;
}

function weekdayLabel(instant: number): string {
  const label = WEEKDAY_LABELS[civil(instant).weekday];
  if (label === undefined) invalid('weekday is outside Monday to Sunday');
  return label;
}

function sameDay(left: number, right: number): boolean {
  const a = civil(left);
  const b = civil(right);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function beijingDate(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
}

function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + offset;
  const shiftedYear = Math.floor(index / 12);
  return { year: shiftedYear, month: index - shiftedYear * 12 + 1 };
}

function spanOf(row: ContestRow): Span {
  const begin = parseInstant(row.beginAt);
  const end = parseInstant(row.endAt);
  if (end < begin) invalid(`row ${row.id} ends before it starts`);
  return { row, begin, end };
}

function spansOf(rows: readonly ContestRow[]): Span[] {
  return rows.map(spanOf);
}

function stateOf(span: Span, nowMs: number): CalendarState {
  if (span.end <= nowMs) return 'end';
  if (span.begin <= nowMs) return span.end - nowMs <= DAY_MS ? 'soon' : 'run';
  return 'up';
}

function pointOf(span: Span): boolean {
  return span.end - span.begin <= POINT_LIMIT_MS && sameDay(span.begin, span.end);
}

function overlaps(span: Span, startMs: number, endMs: number): boolean {
  return span.begin < endMs && span.end > startMs;
}

function compareBegin(left: Span, right: Span): number {
  return left.begin - right.begin || left.row.id.localeCompare(right.row.id);
}

export function calendarState(row: ContestRow, nowMs: number): CalendarState {
  return stateOf(spanOf(row), requireFinite(nowMs, 'now'));
}

export function isPointEvent(row: ContestRow): boolean {
  return pointOf(spanOf(row));
}

function pointLabel(span: Span): string {
  const hours = Math.round((span.end - span.begin) / HOUR_MS);
  return `${clock(span.begin)} \u00B7 ${hours} 小时`;
}

function barLabel(span: Span, state: CalendarState, weekEnd: number): string {
  if (state === 'end') return '已截止';
  if (state === 'up') return `${weekdayLabel(span.begin)} ${clock(span.begin)} 开始`;
  const when = span.end < weekEnd ? `${weekdayLabel(span.end)} ` : `${monthDay(span.end)} `;
  return `截止 ${when}${clock(span.end)}`;
}

export function weekBars(rows: readonly ContestRow[], weekStartMs: number, nowMs: number): WeekBar[] {
  const weekStart = requireFinite(weekStartMs, 'weekStart');
  const now = requireFinite(nowMs, 'now');
  const weekEnd = weekStart + WEEK_MS;
  return spansOf(rows)
    .filter((span) => overlaps(span, weekStart, weekEnd))
    .sort(compareBegin)
    .map((span): WeekBar => {
      const state = stateOf(span, now);
      const point = pointOf(span);
      if (point) {
        const left = Math.min(1, Math.max(0, (span.begin - weekStart) / WEEK_MS));
        return {
          row: span.row,
          state,
          kind: 'point',
          left,
          width: 0,
          clippedStart: false,
          clippedEnd: false,
          label: pointLabel(span),
        };
      }
      const visibleStart = Math.max(span.begin, weekStart);
      const visibleEnd = Math.min(span.end, weekEnd);
      return {
        row: span.row,
        state,
        kind: 'bar',
        left: (visibleStart - weekStart) / WEEK_MS,
        width: (visibleEnd - visibleStart) / WEEK_MS,
        clippedStart: span.begin < weekStart,
        clippedEnd: span.end > weekEnd,
        label: barLabel(span, state, weekEnd),
      };
    });
}

function deadlineTimeLabel(end: number, weekStart: number, weekEnd: number): string {
  return end >= weekStart && end < weekEnd ? clock(end) : slashDay(end);
}

function monthTitle(nowMs: number, monthOffset: number): string {
  if (monthOffset === 0) return '本月';
  const now = civil(nowMs);
  const target = shiftMonth(now.year, now.month, monthOffset);
  return `${target.year} 年 ${target.month} 月`;
}

function weekRelative(offset: number): string {
  if (offset === 0) return '本周';
  if (offset === 1) return '下周';
  if (offset === -1) return '上周';
  if (offset > 1) return `${offset} 周后`;
  return `${-offset} 周前`;
}

function endsInRange(span: Span, fromMs: number, toMs: number): boolean {
  return span.end >= fromMs && span.end < toMs;
}

export function calendarHeadline(
  rows: readonly ContestRow[],
  mode: 'week' | 'month',
  offset: number,
  fromMs: number,
  toMs: number,
  nowMs: number,
): CalendarHeadline {
  const shift = requireInteger(offset, 'offset');
  const from = requireFinite(fromMs, 'from');
  const to = requireFinite(toMs, 'to');
  const now = requireFinite(nowMs, 'now');
  if (mode !== 'week' && mode !== 'month') invalid(`unknown calendar mode ${String(mode)}`);
  if (to <= from) invalid('calendar range must contain a positive duration');
  const due = spansOf(rows).filter((span) => endsInRange(span, from, to));
  const current = shift === 0;
  return {
    count: due.length,
    remaining: current ? due.filter((span) => span.row.done === false && span.end > now).length : null,
    caption: mode === 'week'
      ? (current ? '项在本周截止' : '项在这周截止')
      : (current ? '项在本月截止' : '项在这个月截止'),
    relative: mode === 'week' ? weekRelative(shift) : monthTitle(now, shift),
    range: mode === 'week' ? `${monthDay(from)} \u2013 ${monthDay(to - 1)}` : null,
  };
}

function monthEvents(spans: readonly Span[], dayMs: number, nowMs: number): MonthEvent[] {
  const events: Array<MonthEvent & { at: number }> = [];
  for (const span of spans) {
    const state = stateOf(span, nowMs);
    const done = span.row.done;
    if (pointOf(span)) {
      if (!sameDay(span.begin, dayMs)) continue;
      events.push({
        row: span.row,
        kind: 'point',
        label: `${clock(span.begin)} ${span.row.title}`,
        done,
        soon: state === 'soon',
        at: span.begin,
      });
      continue;
    }
    if (sameDay(span.begin, dayMs)) {
      events.push({
        row: span.row,
        kind: 'start',
        label: `开始 ${span.row.title}`,
        done,
        soon: false,
        at: span.begin,
      });
    }
    if (sameDay(span.end, dayMs)) {
      events.push({
        row: span.row,
        kind: 'due',
        label: `截止 ${span.row.title}`,
        done,
        soon: state === 'soon',
        at: span.end,
      });
    }
  }
  events.sort((left, right) => left.at - right.at || left.row.id.localeCompare(right.row.id));
  return events.map((event) => ({
    row: event.row,
    kind: event.kind,
    label: event.label,
    done: event.done,
    soon: event.soon,
  }));
}

export function monthGrid(rows: readonly ContestRow[], monthOffset: number, nowMs: number): MonthGrid {
  const offset = requireInteger(monthOffset, 'monthOffset');
  const now = requireFinite(nowMs, 'now');
  const nowCivil = civil(now);
  const target = shiftMonth(nowCivil.year, nowCivil.month, offset);
  const next = shiftMonth(target.year, target.month, 1);
  const monthStart = beijingDate(target.year, target.month, 1);
  const monthEnd = beijingDate(next.year, next.month, 1);
  const fromMs = schoolWeekStart(monthStart);
  const spans = spansOf(rows).sort(compareBegin);
  const cells: MonthCell[] = [];
  let cursor = fromMs;
  while (cursor < monthEnd || ((cursor - fromMs) / DAY_MS) % 7 !== 0) {
    const time = civil(cursor);
    cells.push({
      dayMs: cursor,
      inMonth: time.year === target.year && time.month === target.month,
      today: time.year === nowCivil.year && time.month === nowCivil.month && time.day === nowCivil.day,
      events: monthEvents(spans, cursor, now),
    });
    cursor += DAY_MS;
    if (cells.length > 42) invalid('month grid exceeded six weeks');
  }
  return {
    cells,
    fromMs,
    toMs: cursor,
    title: monthTitle(now, offset),
  };
}

function pushAgenda(
  items: TimedAgendaItem[],
  span: Span,
  what: AgendaItem['what'],
  at: number,
  timeLabel: string,
): void {
  items.push({ row: span.row, what, timeLabel, at });
}

function dayItems(spans: readonly Span[], dayMs: number, weekStart: number, weekEnd: number, nowMs: number): AgendaItem[] {
  const items: TimedAgendaItem[] = [];
  for (const span of spans) {
    if (pointOf(span)) {
      if (sameDay(span.begin, dayMs)) pushAgenda(items, span, '考试', span.begin, clock(span.begin));
      continue;
    }
    if (sameDay(span.begin, dayMs) && span.begin > nowMs) {
      pushAgenda(items, span, '开始', span.begin, clock(span.begin));
    }
    if (sameDay(span.end, dayMs)) {
      pushAgenda(items, span, '截止', span.end, deadlineTimeLabel(span.end, weekStart, weekEnd));
    }
  }
  items.sort((left, right) => left.at - right.at || left.row.id.localeCompare(right.row.id));
  return items.map((item) => ({ row: item.row, what: item.what, timeLabel: item.timeLabel }));
}

export function weekAgenda(rows: readonly ContestRow[], weekStartMs: number, nowMs: number): AgendaGroup[] {
  const weekStart = requireFinite(weekStartMs, 'weekStart');
  const now = requireFinite(nowMs, 'now');
  const weekEnd = weekStart + WEEK_MS;
  const spans = spansOf(rows).sort(compareBegin);
  const groups: AgendaGroup[] = [];
  if (now >= weekStart && now < weekEnd) {
    const running = spans.filter((span) => {
      const state = stateOf(span, now);
      return span.row.done === false && (state === 'run' || state === 'soon');
    });
    if (running.length > 0) {
      groups.push({
        key: 'running',
        title: '进行中',
        subtitle: `${running.length} 项`,
        items: running.map((span) => ({
          row: span.row,
          what: '截止',
          timeLabel: deadlineTimeLabel(span.end, weekStart, weekEnd),
        })),
      });
    }
  }
  for (let day = weekStart; day < weekEnd; day += DAY_MS) {
    const items = dayItems(spans, day, weekStart, weekEnd, now);
    if (items.length === 0) continue;
    const time = civil(day);
    groups.push({
      key: `day:${day}`,
      title: sameDay(day, now) ? '今天' : weekdayLabel(day),
      subtitle: `${time.month}月${time.day}日`,
      items,
    });
  }
  return groups;
}
