// A static import fails collection while src/pages/problem-sets/calendar-week.tsx is absent.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { studentSetRowView, type ContestRow } from '../../src/pages/problem-sets/model.ts';

const weekLoaders = import.meta.glob('../../src/pages/problem-sets/calendar-week.tsx');
const WEEK_SOURCE = 'src/pages/problem-sets/calendar-week.tsx';

const NOW = Date.parse('2026-10-21T14:32:00+08:00');
const WEEK_START = Date.parse('2026-10-19T00:00:00+08:00');
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const EN_DASH = '\u2013';
const NOW_LABEL = '此刻 14:32';
const EMPTY_WEEK = '这一周没有考试和作业。';
const CHAPTER_THREE_LABEL = '截止 周四 12:00';
const CHAPTER_FOUR_LABEL = '截止 10月29日 23:59';
const CHAPTER_FOUR_RANGE = `10月20日 08:00 ${EN_DASH} 10月29日 23:59`;
const POINT_DOT = '\u00B7';
const MIDTERM_POINT = `19:00 ${POINT_DOT} 2 小时`;
const SATURDAY_POINT = `13:00 ${POINT_DOT} 4 小时`;
const RUNNING = '进行中';
const OUTSIDE = '页面空白';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const TRIGGER_LEFT = 240;
const TRIGGER_TOP = 760;
const TRIGGER_WIDTH = 360;
const TRIGGER_HEIGHT = 28;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 220;

interface CalendarWeekProps {
  rows: readonly ContestRow[];
  weekStartMs: number;
  nowMs: number;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function weekLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(weekLoaders)) {
    if (!key.endsWith(WEEK_SOURCE)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadCalendarWeek(): Promise<(props: CalendarWeekProps) => ReactElement> {
  const load = weekLoader();
  expect(typeof load, `${WEEK_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${WEEK_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${WEEK_SOURCE} must be a module`);
  const component = readField(imported, 'CalendarWeek');
  expect(typeof component, 'CalendarWeek').toBe('function');
  if (typeof component !== 'function') throw new TypeError('CalendarWeek must be a function');
  return component as (props: CalendarWeekProps) => ReactElement;
}

function contest(
  fields: Partial<ContestRow> & Pick<ContestRow, 'id' | 'kind' | 'title' | 'beginAt' | 'endAt'>,
): ContestRow {
  const homework = fields.kind === 'homework';
  return {
    flavor: homework ? 'homework' : 'paper',
    href: homework ? `/homework/${fields.id}` : `/contest/${fields.id}`,
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: false,
    clientRequired: false,
    team: false,
    problemCount: homework ? 12 : 1,
    progress: homework ? { answered: 0 } : null,
    finalized: false,
    done: false,
    ...fields,
  };
}

const chapterTwo = contest({
  id: 'h2',
  kind: 'homework',
  title: '第二章 分支结构',
  beginAt: '2026-10-07T08:00:00+08:00',
  endAt: '2026-10-19T23:59:00+08:00',
  done: true,
  progress: { answered: 12 },
});

const chapterThree = contest({
  id: 'h3',
  kind: 'homework',
  title: '第三章 循环结构',
  beginAt: '2026-10-14T08:00:00+08:00',
  endAt: '2026-10-22T12:00:00+08:00',
  problemCount: 12,
  progress: { answered: 8 },
});

const contestSix = contest({
  id: 'o6',
  kind: 'exam',
  flavor: 'oi',
  title: '周赛 #6',
  beginAt: '2026-10-19T19:00:00+08:00',
  endAt: '2026-10-19T21:00:00+08:00',
  done: true,
});

const chapterFour = contest({
  id: 'h4',
  kind: 'homework',
  title: '第四章 数组',
  beginAt: '2026-10-20T08:00:00+08:00',
  endAt: '2026-10-29T23:59:00+08:00',
  problemCount: 15,
  progress: { answered: 0 },
});

const midterm = contest({
  id: 'p1',
  kind: 'exam',
  flavor: 'paper',
  title: '期中测验',
  beginAt: '2026-10-23T19:00:00+08:00',
  endAt: '2026-10-23T21:00:00+08:00',
});

const contestSeven = contest({
  id: 'o7',
  kind: 'exam',
  flavor: 'oi',
  title: '周赛 #7',
  beginAt: '2026-10-26T19:00:00+08:00',
  endAt: '2026-10-26T21:00:00+08:00',
});

const saturdayPoint = contest({
  id: 'a1',
  kind: 'exam',
  flavor: 'acm',
  title: '校赛热身赛',
  beginAt: '2026-10-25T13:00:00+08:00',
  endAt: '2026-10-25T17:00:00+08:00',
});

/** Intersecting rows are intentionally not sorted; 周赛 #7 starts after this week. */
const WEEK_ROWS: readonly ContestRow[] = [
  contestSeven,
  chapterFour,
  midterm,
  chapterThree,
  contestSix,
  chapterTwo,
];

const VISIBLE_TITLES = [
  chapterTwo.title,
  chapterThree.title,
  contestSix.title,
  chapterFour.title,
  midterm.title,
] as const;

function flatText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function pixelValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'auto') return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function insetTop(element: HTMLElement): number | null {
  const parts = element.style.inset.trim().split(/\s+/);
  const top = parts[0];
  if (top === undefined) return null;
  return pixelValue(top);
}

function positionedTop(dialog: HTMLElement): number | null {
  const nodes: HTMLElement[] = [];
  let current: HTMLElement | null = dialog;
  while (current && current !== document.body && current !== document.documentElement) {
    nodes.push(current);
    current = current.parentElement;
  }
  nodes.push(...dialog.querySelectorAll<HTMLElement>('*'));
  for (const node of nodes) {
    const top = pixelValue(node.style.top) ?? insetTop(node);
    if (top !== null) return top;
  }
  for (const node of nodes) {
    const bottom = pixelValue(node.style.bottom);
    if (bottom === null) continue;
    return VIEWPORT_HEIGHT - bottom - CARD_HEIGHT;
  }
  return null;
}

function outsideDialog(text: string): HTMLElement {
  const found = screen.getAllByText(text).filter((element) => element.closest('[role="dialog"]') === null);
  expect(found, text).toHaveLength(1);
  const label = found[0];
  if (!label) throw new Error(text);
  return label;
}

function rowContaining(title: string): HTMLElement {
  let current: HTMLElement | null = outsideDialog(title);
  while (current && current !== document.body) {
    if (current.querySelectorAll('button').length >= 2) return current;
    current = current.parentElement;
  }
  throw new Error(`${title} row is missing`);
}

function expectDocumentOrder(titles: readonly string[]): void {
  const nodes = titles.map((title) => screen.getByText(title));
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    if (!previous || !current) throw new Error('missing ordered title');
    expect(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  }
}

async function renderWeek(props: CalendarWeekProps, options: { pageScroll?: boolean } = {}) {
  const CalendarWeek = await loadCalendarWeek();
  const week = <CalendarWeek rows={props.rows} weekStartMs={props.weekStartMs} nowMs={props.nowMs} />;
  // 40px is shorter than one week row, so this node is the page scroller.
  const body = options.pageScroll
    ? <div data-page-scroll="" style={{ height: '40px', overflow: 'auto' }}>{week}</div>
    : week;
  const view = render(
    <>
      <button type="button">{OUTSIDE}</button>
      {body}
    </>,
  );
  const scrollerNode = view.container.querySelector('[data-page-scroll]');
  const pageScroll = scrollerNode instanceof HTMLElement ? scrollerNode : null;
  return { CalendarWeek, pageScroll, ...view };
}

function openDialog(): HTMLElement {
  const dialogs = screen.getAllByRole('dialog');
  expect(dialogs).toHaveLength(1);
  const dialog = dialogs[0];
  if (!dialog) throw new Error('missing dialog');
  expect(document.body.contains(dialog)).toBe(true);
  return dialog;
}

function installBottomViewport(): () => void {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  window.innerWidth = VIEWPORT_WIDTH;
  window.innerHeight = VIEWPORT_HEIGHT;
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => (
    new DOMRect(TRIGGER_LEFT, TRIGGER_TOP, TRIGGER_WIDTH, TRIGGER_HEIGHT)
  ));
  const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => CARD_HEIGHT);
  const widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => CARD_WIDTH);
  return () => {
    rectSpy.mockRestore();
    heightSpy.mockRestore();
    widthSpy.mockRestore();
    window.innerWidth = previousWidth;
    window.innerHeight = previousHeight;
  };
}

describe('calendar week view', () => {
  it('renders five rows in begin order and marks chapter three as soon', async () => {
    await renderWeek({ rows: WEEK_ROWS, weekStartMs: WEEK_START, nowMs: NOW });

    expect(screen.queryByText(contestSeven.title)).toBeNull();
    expectDocumentOrder(VISIBLE_TITLES);
    const soonLabel = outsideDialog(CHAPTER_THREE_LABEL);
    const stateHost = soonLabel.closest('[data-state]');
    expect(stateHost).not.toBeNull();
    expect(stateHost).toHaveAttribute('data-state', 'soon');
    expect(flatText(stateHost?.textContent)).toContain(CHAPTER_THREE_LABEL);
    expect(flatText(stateHost?.textContent)).not.toContain(chapterFour.title);
  });

  it('shows the current time label only on the current week', async () => {
    const view = await renderWeek({ rows: WEEK_ROWS, weekStartMs: WEEK_START, nowMs: NOW });
    expect(screen.getByText(NOW_LABEL)).toBeTruthy();

    const { CalendarWeek } = view;
    view.rerender(
      <>
        <button type="button">{OUTSIDE}</button>
        <CalendarWeek rows={WEEK_ROWS} weekStartMs={WEEK_START + WEEK_MS} nowMs={NOW} />
      </>,
    );
    expect(screen.queryByText(NOW_LABEL)).toBeNull();
  });

  it('opens one card from a bar, swaps rows, and closes on escape', async () => {
    const user = userEvent.setup();
    const action = studentSetRowView(chapterFour, NOW).action;
    expect(action, 'chapter four action').not.toBeNull();
    if (!action) throw new Error('chapter four action missing');
    const view = await renderWeek({ rows: WEEK_ROWS, weekStartMs: WEEK_START, nowMs: NOW });

    await user.click(outsideDialog(CHAPTER_FOUR_LABEL));
    const dialog = openDialog();
    expect(view.container.contains(dialog)).toBe(false);
    expect(flatText(dialog.textContent)).toContain(RUNNING);
    expect(flatText(dialog.textContent)).toContain(CHAPTER_FOUR_RANGE);
    const link = within(dialog).getByRole('link', { name: action.label });
    expect(link).toHaveAttribute('href', action.href);

    await user.click(outsideDialog(CHAPTER_THREE_LABEL));
    const swapped = openDialog();
    expect(flatText(swapped.textContent)).toContain(chapterThree.title);
    expect(flatText(swapped.textContent)).not.toContain(CHAPTER_FOUR_RANGE);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the card from the row title and from a point', async () => {
    const user = userEvent.setup();
    await renderWeek({ rows: WEEK_ROWS, weekStartMs: WEEK_START, nowMs: NOW });

    await user.click(screen.getByText(chapterFour.title));
    const fromTitle = openDialog();
    expect(flatText(fromTitle.textContent)).toContain(CHAPTER_FOUR_RANGE);

    await user.click(within(rowContaining(midterm.title)).getByText(MIDTERM_POINT));
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    const fromPoint = dialogs[0];
    if (!fromPoint) throw new Error('missing dialog');
    expect(flatText(fromPoint.textContent)).toContain(midterm.title);
    expect(flatText(fromPoint.textContent)).not.toContain(CHAPTER_FOUR_RANGE);
  });

  it('places a late point label to the left of the dot', async () => {
    await renderWeek({
      rows: [...WEEK_ROWS, saturdayPoint],
      weekStartMs: WEEK_START,
      nowMs: NOW,
    });
    const button = screen.getByText(SATURDAY_POINT).closest('button');
    expect(button).toBeInstanceOf(HTMLButtonElement);
    if (!(button instanceof HTMLButtonElement)) throw new Error('point trigger missing');
    expect(button.style.right).not.toBe('');
    expect(button.style.left).toBe('');
    expect(button.classList.contains('flex-row-reverse')).toBe(true);
  });

  it('places the card above a trigger near the bottom of the viewport', async () => {
    const user = userEvent.setup();
    await renderWeek({ rows: WEEK_ROWS, weekStartMs: WEEK_START, nowMs: NOW });
    const restore = installBottomViewport();
    try {
      await user.click(outsideDialog(CHAPTER_FOUR_LABEL));
      const dialog = openDialog();
      const top = positionedTop(dialog);
      expect(typeof top, 'card top').toBe('number');
      if (typeof top !== 'number') throw new Error('card top missing');
      expect(top).toBeLessThan(TRIGGER_TOP);
    } finally {
      restore();
    }
  });

  it('shows an empty week message', async () => {
    await renderWeek({ rows: [], weekStartMs: WEEK_START, nowMs: NOW });
    expect(screen.getByText(EMPTY_WEEK)).toBeTruthy();
  });

  it('closes the card on an outside click and on page scroll', async () => {
    const user = userEvent.setup();
    const view = await renderWeek(
      { rows: WEEK_ROWS, weekStartMs: WEEK_START, nowMs: NOW },
      { pageScroll: true },
    );
    const scroller = view.pageScroll;
    if (!scroller) throw new Error('page scroller missing');

    await user.click(outsideDialog(CHAPTER_FOUR_LABEL));
    openDialog();
    await user.click(screen.getByRole('button', { name: OUTSIDE }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(outsideDialog(CHAPTER_FOUR_LABEL));
    openDialog();
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
