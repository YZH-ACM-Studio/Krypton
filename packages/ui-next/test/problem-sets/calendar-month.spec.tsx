// A static import fails collection while the month and agenda modules are absent.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  schoolWeekStart,
  studentSetRowView,
  type ContestRow,
  type RowView,
} from '../../src/pages/problem-sets/model.ts';

const monthLoaders = import.meta.glob('../../src/pages/problem-sets/calendar-month.tsx');
const agendaLoaders = import.meta.glob('../../src/pages/problem-sets/calendar-agenda.tsx');
const MONTH_SOURCE = 'src/pages/problem-sets/calendar-month.tsx';
const AGENDA_SOURCE = 'src/pages/problem-sets/calendar-agenda.tsx';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-21T14:32:00+08:00');
const WEEK_OCT_12 = Date.parse('2026-10-12T00:00:00+08:00');
const WEEK_OCT_19 = Date.parse('2026-10-19T00:00:00+08:00');
const WEEK_OCT_26 = Date.parse('2026-10-26T00:00:00+08:00');
const DUE_LABEL = '截止 第三章 循环结构';
const MORE_LABEL = '还有 2 项';

type MonthKind = 'start' | 'due' | 'point';
type AgendaWhat = '截止' | '开始' | '考试';

interface MonthEvent {
  row: ContestRow;
  kind: MonthKind;
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

interface AgendaItem {
  row: ContestRow;
  what: AgendaWhat;
  timeLabel: string;
}

interface AgendaGroup {
  key: string;
  title: string;
  subtitle: string;
  items: AgendaItem[];
}

interface MonthProps {
  cells: readonly MonthCell[];
  onPickWeek: (weekStartMs: number) => void;
}

interface AgendaProps {
  groups: readonly AgendaGroup[];
  nowMs: number;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): (props: Props) => ReactElement {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as (props: Props) => ReactElement;
}

async function loadNamed<Props>(
  loaders: Record<string, unknown>,
  source: string,
  name: string,
): Promise<(props: Props) => ReactElement> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(loaders)) {
    if (key.endsWith(source)) load = candidate;
  }
  expect(typeof load, `${source} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${source} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${source} must be a module`);
  return asComponent<Props>(readField(imported, name), name);
}

function beijingMidnight(day: string): number {
  return Date.parse(`${day}T00:00:00+08:00`);
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

function monthEvent(entry: ContestRow, kind: MonthKind, label: string, soon = false): MonthEvent {
  return {
    row: entry,
    kind,
    label,
    done: entry.done,
    soon,
  };
}

function homework(id: string, title: string, beginAt: string, endAt = '2026-10-30T18:00:00+08:00'): ContestRow {
  return row({
    id,
    kind: 'homework',
    title,
    href: `/homework/${id}`,
    beginAt,
    endAt,
  });
}

const loopHomework = row({
  id: 'h3',
  kind: 'homework',
  title: '第三章 循环结构',
  href: '/homework/h3',
  beginAt: '2026-10-20T08:00:00+08:00',
  endAt: '2026-10-29T23:59:00+08:00',
  attended: true,
  problemCount: 12,
  progress: { answered: 8 },
});

const visibleStart = homework('visible-start', '可见甲', '2026-10-14T08:00:00+08:00');
const visibleDue = homework('visible-due', '可见乙', '2026-10-14T08:00:00+08:00');
const visiblePoint = row({
  id: 'visible-point',
  kind: 'exam',
  flavor: 'paper',
  title: '可见丙',
  href: '/contest/visible-point',
  beginAt: '2026-10-14T09:00:00+08:00',
  endAt: '2026-10-14T11:00:00+08:00',
});
const hiddenStart = homework('hidden-start', '隐藏丁', '2026-10-14T08:00:00+08:00');
const hiddenDue = homework('hidden-due', '隐藏戊', '2026-10-14T08:00:00+08:00');

const agendaChapter = row({
  id: 'agenda-h3',
  kind: 'homework',
  title: '第三章 循环结构',
  href: '/homework/h3',
  beginAt: '2026-10-14T08:00:00+08:00',
  endAt: '2026-10-22T12:00:00+08:00',
  attended: true,
  problemCount: 12,
  progress: { answered: 8 },
});

const agendaLive = row({
  id: 'live',
  kind: 'exam',
  flavor: 'paper',
  title: '正在作答的测验',
  href: '/contest/live',
  beginAt: '2026-10-21T08:00:00+08:00',
  endAt: '2026-10-21T21:00:00+08:00',
  startAt: '2026-10-21T09:00:00+08:00',
  personalEndAt: '2026-10-21T18:00:00+08:00',
  durationMinutes: 120,
  attended: true,
  problemCount: 10,
  progress: { answered: 3 },
});

const agendaMidterm = row({
  id: 'midterm',
  kind: 'exam',
  flavor: 'paper',
  title: '期中测验',
  href: '/contest/midterm',
  beginAt: '2026-10-21T19:00:00+08:00',
  endAt: '2026-10-21T21:00:00+08:00',
  problemCount: 10,
});

const agendaWarmup = row({
  id: 'acm1',
  kind: 'exam',
  flavor: 'acm',
  title: '校赛热身赛',
  href: '/contest/acm1',
  beginAt: '2026-10-22T13:00:00+08:00',
  endAt: '2026-10-22T17:00:00+08:00',
  problemCount: 5,
});

function octoberGrid(): MonthCell[] {
  const start = beijingMidnight('2026-09-28');
  return Array.from({ length: 35 }, (_, index) => ({
    dayMs: start + index * DAY_MS,
    inMonth: index >= 3 && index <= 33,
    today: index === 23,
    events: [],
  }));
}

function withEvents(cells: readonly MonthCell[], day: string, events: MonthEvent[]): MonthCell[] {
  const dayMs = beijingMidnight(day);
  return cells.map((cell) => (cell.dayMs === dayMs ? { ...cell, events } : cell));
}

function buildOctober(): MonthCell[] {
  return withEvents(
    withEvents(
      withEvents(octoberGrid(), '2026-10-29', [
        monthEvent(loopHomework, 'due', DUE_LABEL, true),
      ]),
      '2026-10-28',
      [
        monthEvent(visibleStart, 'start', '开始 可见甲'),
        monthEvent(visibleDue, 'due', '截止 可见乙'),
        monthEvent(visiblePoint, 'point', '09:00 可见丙'),
        monthEvent(hiddenStart, 'start', '开始 隐藏丁'),
        monthEvent(hiddenDue, 'due', '截止 隐藏戊'),
      ],
    ),
    '2026-10-15',
    [
      monthEvent(homework('exact-1', '恰好一', '2026-10-15T08:00:00+08:00'), 'start', '开始 恰好一'),
      monthEvent(homework('exact-2', '恰好二', '2026-10-15T08:00:00+08:00'), 'due', '截止 恰好二'),
      monthEvent(row({
        id: 'exact-3',
        kind: 'exam',
        flavor: 'paper',
        title: '恰好三',
        href: '/contest/exact-3',
        beginAt: '2026-10-15T10:00:00+08:00',
        endAt: '2026-10-15T12:00:00+08:00',
      }), 'point', '10:00 恰好三'),
    ],
  );
}

function requireAction(entry: ContestRow, nowMs: number): NonNullable<RowView['action']> {
  const action = studentSetRowView(entry, nowMs).action;
  if (action === null) throw new TypeError(`${entry.title} has no action`);
  return action;
}

function agendaGroups(): AgendaGroup[] {
  return [
    {
      key: 'running',
      title: '进行中',
      subtitle: '2 项',
      items: [
        { row: agendaChapter, what: '截止', timeLabel: '12:00' },
        { row: agendaLive, what: '截止', timeLabel: '18:00' },
      ],
    },
    {
      key: '2026-10-21',
      title: '今天',
      subtitle: '10月21日',
      items: [
        { row: agendaMidterm, what: '考试', timeLabel: '19:00' },
      ],
    },
    {
      key: '2026-10-22',
      title: '周四',
      subtitle: '10月22日',
      items: [
        { row: agendaWarmup, what: '开始', timeLabel: '13:00' },
      ],
    },
  ];
}

function dayCells(): HTMLElement[] {
  const gridCells = screen.queryAllByRole('gridcell');
  if (gridCells.length > 0) return gridCells;
  return screen.getAllByRole('cell');
}

function cellAt(cells: readonly MonthCell[], rendered: readonly HTMLElement[], day: string): HTMLElement {
  const index = cells.findIndex((cell) => cell.dayMs === beijingMidnight(day));
  const element = rendered[index];
  if (!element) throw new TypeError(`missing rendered cell ${day}`);
  return element;
}

function ownText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

function dayHost(cell: HTMLElement, day: string): HTMLElement {
  const nodes = [cell, ...cell.querySelectorAll('*')];
  for (const node of nodes) {
    if (node instanceof HTMLElement && ownText(node) === day) return node;
  }
  throw new TypeError(`day ${day} is not shown in "${cell.textContent ?? ''}"`);
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token !== '');
}

function nearestFg(start: Element, stop: Element): string | null {
  let current: Element | null = start;
  while (current) {
    const token = classTokens(current).find((item) => (
      item === 'text-fg' || item === 'text-fg-subtle' || item === 'text-fg-muted' || item === 'text-brand-fg'
    ));
    if (token) return token;
    if (current === stop) break;
    current = current.parentElement;
  }
  return null;
}

function isWeakenedDay(cell: HTMLElement, day: string, stop: Element): boolean {
  const token = nearestFg(dayHost(cell, day), stop);
  return token === 'text-fg-subtle' || token === 'text-fg-muted';
}

function marksCurrentDate(cell: HTMLElement): boolean {
  if (cell.getAttribute('aria-current') === 'date') return true;
  return cell.querySelector('[aria-current="date"]') instanceof Element;
}

function earliest(text: string): HTMLElement {
  const matches = screen.getAllByText(text, { exact: false }).filter((element): element is HTMLElement => (
    element instanceof HTMLElement && !Array.from(element.children).some((child) => (child.textContent ?? '').includes(text))
  ));
  const found = matches[0];
  if (!found) throw new TypeError(`missing ${text}`);
  return found;
}

function isBefore(earlier: HTMLElement, later: HTMLElement): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function itemScope(link: HTMLElement, title: string): HTMLElement {
  let current: HTMLElement | null = link;
  while (current.parentElement) {
    if ((current.textContent ?? '').includes(title)) return current;
    current = current.parentElement;
  }
  throw new TypeError(`missing agenda item ${title}`);
}

function expectAgendaItem(title: string, what: AgendaWhat, timeLabel: string, action: NonNullable<RowView['action']>, details: readonly string[]) {
  const link = screen.getByRole('link', { name: action.label });
  expect(link.getAttribute('href')).toBe(action.href);
  const text = itemScope(link, title).textContent ?? '';
  expect(text).toContain(title);
  expect(text).toContain(what);
  expect(text).toContain(timeLabel);
  for (const detail of details) expect(text).toContain(detail);
}

describe('calendar month', () => {
  it('renders 35 days, marks 10/21 as the current date, and weakens days outside the month', async () => {
    const cells = buildOctober();
    expect(cells).toHaveLength(35);
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(cells.find((cell) => cell.today)?.dayMs).toBe(beijingMidnight('2026-10-21'));

    const CalendarMonth = await loadNamed<MonthProps>(monthLoaders, MONTH_SOURCE, 'CalendarMonth');
    const { container } = render(<CalendarMonth cells={cells} onPickWeek={vi.fn()} />);
    const rendered = dayCells();
    expect(rendered).toHaveLength(35);

    const today = cellAt(cells, rendered, '2026-10-21');
    const marked = rendered.filter(marksCurrentDate);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(today);
    expect(today.textContent).toContain('21');

    expect(isWeakenedDay(cellAt(cells, rendered, '2026-09-28'), '28', container)).toBe(true);
    expect(isWeakenedDay(cellAt(cells, rendered, '2026-11-01'), '1', container)).toBe(true);
    expect(isWeakenedDay(cellAt(cells, rendered, '2026-10-16'), '16', container)).toBe(false);
  });

  it('shows three events and a remaining count when a day has five', async () => {
    const cells = buildOctober();
    const CalendarMonth = await loadNamed<MonthProps>(monthLoaders, MONTH_SOURCE, 'CalendarMonth');
    render(<CalendarMonth cells={cells} onPickWeek={vi.fn()} />);
    const rendered = dayCells();
    const crowded = within(cellAt(cells, rendered, '2026-10-28'));
    expect(crowded.getByRole('button', { name: '开始 可见甲' })).toBeInTheDocument();
    expect(crowded.getByRole('button', { name: '截止 可见乙' })).toBeInTheDocument();
    expect(crowded.getByRole('button', { name: '09:00 可见丙' })).toBeInTheDocument();
    expect(crowded.getByRole('button', { name: MORE_LABEL })).toBeInTheDocument();
    expect(crowded.queryByText('开始 隐藏丁')).toBeNull();
    expect(crowded.queryByText('截止 隐藏戊')).toBeNull();

    const exact = within(cellAt(cells, rendered, '2026-10-15'));
    expect(exact.getByRole('button', { name: '开始 恰好一' })).toBeInTheDocument();
    expect(exact.getByRole('button', { name: '截止 恰好二' })).toBeInTheDocument();
    expect(exact.getByRole('button', { name: '10:00 恰好三' })).toBeInTheDocument();
    expect(exact.queryByText(/还有/)).toBeNull();
  });

  it('opens the monday of beginAt when an event is chosen', async () => {
    // The due chip sits on 10/29 so the callback is Monday of beginAt, not of the cell.
    expect(schoolWeekStart(Date.parse(loopHomework.beginAt))).toBe(WEEK_OCT_19);
    expect(schoolWeekStart(beijingMidnight('2026-10-29'))).toBe(WEEK_OCT_26);

    const cells = buildOctober();
    const onPickWeek = vi.fn<(weekStartMs: number) => void>();
    const CalendarMonth = await loadNamed<MonthProps>(monthLoaders, MONTH_SOURCE, 'CalendarMonth');
    render(<CalendarMonth cells={cells} onPickWeek={onPickWeek} />);
    await userEvent.setup().click(screen.getByRole('button', { name: DUE_LABEL }));
    expect(onPickWeek).toHaveBeenCalledTimes(1);
    expect(onPickWeek).toHaveBeenCalledWith(WEEK_OCT_19);
  });

  it('opens the monday of the cell when the remaining count is chosen', async () => {
    expect(schoolWeekStart(Date.parse(visibleStart.beginAt))).toBe(WEEK_OCT_12);
    expect(schoolWeekStart(beijingMidnight('2026-10-28'))).toBe(WEEK_OCT_26);

    const cells = buildOctober();
    const onPickWeek = vi.fn<(weekStartMs: number) => void>();
    const CalendarMonth = await loadNamed<MonthProps>(monthLoaders, MONTH_SOURCE, 'CalendarMonth');
    render(<CalendarMonth cells={cells} onPickWeek={onPickWeek} />);
    const user = userEvent.setup();
    const crowded = within(cellAt(cells, dayCells(), '2026-10-28'));
    await user.click(crowded.getByRole('button', { name: '开始 可见甲' }));
    expect(onPickWeek).toHaveBeenCalledTimes(1);
    expect(onPickWeek).toHaveBeenCalledWith(WEEK_OCT_12);

    onPickWeek.mockClear();
    await user.click(crowded.getByRole('button', { name: MORE_LABEL }));
    expect(onPickWeek).toHaveBeenCalledTimes(1);
    expect(onPickWeek).toHaveBeenCalledWith(WEEK_OCT_26);
  });
});

describe('calendar agenda', () => {
  it('lists the running group before today and uses each row action', async () => {
    const chapterAction = requireAction(agendaChapter, NOW);
    const liveAction = requireAction(agendaLive, NOW);
    const midtermAction = requireAction(agendaMidterm, NOW);
    const warmupAction = requireAction(agendaWarmup, NOW);
    expect(chapterAction.label).toBe('去做');
    expect(liveAction.label).toBe('继续作答');
    expect(midtermAction.label).toBe('查看');
    expect(warmupAction.label).toBe('报名');

    const CalendarAgenda = await loadNamed<AgendaProps>(agendaLoaders, AGENDA_SOURCE, 'CalendarAgenda');
    const { container } = render(<CalendarAgenda groups={agendaGroups()} nowMs={NOW} />);
    expect(isBefore(earliest('进行中'), earliest('今天'))).toBe(true);
    expect(isBefore(earliest('今天'), earliest('周四'))).toBe(true);
    expect(container.textContent).toContain('2 项');
    expect(container.textContent).toContain('10月21日');
    expect(container.textContent).toContain('10月22日');

    const chapterView = studentSetRowView(agendaChapter, NOW);
    const liveView = studentSetRowView(agendaLive, NOW);
    const midtermView = studentSetRowView(agendaMidterm, NOW);
    const warmupView = studentSetRowView(agendaWarmup, NOW);
    expectAgendaItem(agendaChapter.title, '截止', '12:00', chapterAction, [chapterView.typeLabel, chapterView.progress?.text ?? '']);
    expectAgendaItem(agendaLive.title, '截止', '18:00', liveAction, [liveView.typeLabel, liveView.progress?.text ?? '']);
    expectAgendaItem(agendaMidterm.title, '考试', '19:00', midtermAction, [midtermView.typeLabel]);
    expectAgendaItem(agendaWarmup.title, '开始', '13:00', warmupAction, [warmupView.typeLabel]);
  });
});
