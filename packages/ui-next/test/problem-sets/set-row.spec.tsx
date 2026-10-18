// A static import fails collection while src/pages/problem-sets/set-row.tsx is absent.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import {
  studentSetRowView,
  type ContestRow,
  type PracticeRow,
  type StudentSetRow,
} from '../../src/pages/problem-sets/model.ts';

const { NO_ACTION_ID } = vi.hoisted(() => ({
  NO_ACTION_ID: '64b8000000000000000000ff',
}));

// studentSetRowView never returns a null action. This id is the only way to
// reach the specified "no action, no button" branch without changing the model.
vi.mock('../../src/pages/problem-sets/model.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pages/problem-sets/model.ts')>();
  return {
    ...actual,
    studentSetRowView(row: Parameters<typeof actual.studentSetRowView>[0], now: number) {
      const view = actual.studentSetRowView(row, now);
      if (row.id === NO_ACTION_ID) return { ...view, action: null };
      return view;
    },
  };
});

const rowLoaders = import.meta.glob('../../src/pages/problem-sets/set-row.tsx');
const ROW_SOURCE = 'src/pages/problem-sets/set-row.tsx';

const NOW_ISO = '2026-10-18T14:00:00+08:00';
const NOW = Date.parse(NOW_ISO);
const SKEW_ISO = '2026-10-28T14:00:00+08:00';
const SKEW = Date.parse(SKEW_ISO);
const REMAINING_MS = ((1 * 60 + 12) * 60 + 30) * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;
const SECOND_MS = 1000;

const PAPER_TITLE = '数据结构期中考试';
const DONE_TITLE = '已经交卷的期中考试';
const LONG_TITLE = '题'.repeat(60);
const EXAM_HREF = '/contest/64b8000000000000000000a1';
const HOMEWORK_HREF = '/homework/64b8000000000000000000a2';
const PRACTICE_HREF = '/problem-sets/64b8000000000000000000b1';
const PAPER_ID = '64b8000000000000000000a1';
const BEGIN_AT = '2026-10-18T08:00:00+08:00';
const END_AT = '2026-10-18T18:00:00+08:00';
const STARTED_AT = '2026-10-18T13:00:00+08:00';
const DUE_AT = '2026-10-18T13:00:00+08:00';

const COUNTDOWN_TONES = ['text-fg', 'text-warning-fg', 'text-danger-fg'] as const;
type CountdownTone = (typeof COUNTDOWN_TONES)[number];

interface RowItemProps {
  row: StudentSetRow;
  now: number;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function rowLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(rowLoaders)) {
    if (!key.endsWith(ROW_SOURCE)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadRowItem(): Promise<(props: RowItemProps) => ReactElement> {
  const load = rowLoader();
  expect(typeof load, `${ROW_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${ROW_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${ROW_SOURCE} must be a module`);
  const component = readField(imported, 'StudentSetRowItem');
  expect(typeof component, 'StudentSetRowItem').toBe('function');
  if (typeof component !== 'function') throw new TypeError('StudentSetRowItem must be a function');
  return component as (props: RowItemProps) => ReactElement;
}

function pageBootstrap(generatedAt: string): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt,
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/', training: '/problem-sets' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'student_sets.html', data: {} },
  };
}

function paperRow(overrides: Partial<ContestRow> = {}): ContestRow {
  return {
    kind: 'exam',
    id: PAPER_ID,
    flavor: 'paper',
    title: PAPER_TITLE,
    href: EXAM_HREF,
    beginAt: BEGIN_AT,
    endAt: END_AT,
    dueAt: null,
    durationMinutes: 100,
    startAt: STARTED_AT,
    personalEndAt: new Date(NOW + REMAINING_MS).toISOString(),
    attended: true,
    clientRequired: false,
    team: false,
    problemCount: 20,
    progress: { answered: 7 },
    finalized: false,
    done: false,
    ...overrides,
  };
}

function homeworkPastDue(): ContestRow {
  return {
    kind: 'homework',
    id: '64b8000000000000000000a2',
    flavor: 'homework',
    title: '第一次作业',
    href: HOMEWORK_HREF,
    beginAt: BEGIN_AT,
    endAt: END_AT,
    dueAt: DUE_AT,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: true,
    clientRequired: false,
    team: false,
    problemCount: 4,
    progress: { answered: 1 },
    finalized: false,
    done: false,
  };
}

function practiceRow(): PracticeRow {
  return {
    kind: 'practice',
    id: '64b8000000000000000000b1',
    title: 'PAT 甲级训练集',
    href: PRACTICE_HREF,
    stageCount: 3,
    problemCount: 120,
    doneCount: 30,
    sourceLabel: '全站公开',
  };
}

function mediaMatches(query: string, width: number): boolean {
  const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (minWidth) return width >= Number(minWidth[1]);
  const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (maxWidth) return width <= Number(maxWidth[1]);
  return false;
}

function applyViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: mediaMatches(query, width),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia;
}

function pinClock(systemMs: number) {
  vi.useFakeTimers();
  vi.setSystemTime(systemMs);
}

async function flushClock() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function renderRow(row: StudentSetRow, now = NOW) {
  const StudentSetRowItem = await loadRowItem();
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(new Date(NOW).toISOString())}>
      <StudentSetRowItem row={row} now={now} />
    </BootstrapProvider>,
  );
}

function innermostIncluding(text: string): HTMLElement {
  const found = screen.getByText((_, element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (!(element.textContent ?? '').includes(text)) return false;
    return !Array.from(element.children).some((child) => (child.textContent ?? '').includes(text));
  });
  if (!(found instanceof HTMLElement)) throw new TypeError(`missing element for ${text}`);
  return found;
}

function clockText(remainingMs: number): string {
  const total = Math.floor(remainingMs / SECOND_MS);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function countdownElement(clock: string): HTMLElement {
  return innermostIncluding(clock);
}

function expectCountdown(clock: string, tone: CountdownTone) {
  const element = countdownElement(clock);
  expect(element.classList.contains('font-mono')).toBe(true);
  expect(element.classList.contains('tabular')).toBe(true);
  expect(element.classList.contains(tone)).toBe(true);
  for (const other of COUNTDOWN_TONES) {
    if (other !== tone) expect(element.classList.contains(other)).toBe(false);
  }
}

function anchorsIn(event: Event): HTMLAnchorElement[] {
  const found: HTMLAnchorElement[] = [];
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement) found.push(node);
  }
  return found;
}

beforeEach(() => {
  applyViewport(1024);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('student set row', () => {
  it('shows an in-progress paper as 01:12:30 with a tabular countdown and one action link', async () => {
    pinClock(SKEW);
    const row = paperRow();
    const view = studentSetRowView(row, NOW);
    if (view.action === null || view.sub === null) throw new TypeError('paper in progress has an action and a sub line');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const navigated: HTMLAnchorElement[] = [];
    const onClick = (event: Event) => {
      navigated.push(...anchorsIn(event));
    };
    window.addEventListener('click', onClick, true);
    try {
      await renderRow(row);
      await flushClock();

      expectCountdown('01:12:30', 'text-fg');
      expect(screen.getAllByText(/剩余/).length).toBeGreaterThan(0);
      expect(innermostIncluding(view.typeLabel).closest('[data-slot="badge"]')?.getAttribute('data-tone')).toBe('neutral');
      expect(innermostIncluding(row.title).classList.contains('text-fg-muted')).toBe(false);
      expect(screen.getByText(view.meta)).toBeInTheDocument();
      expect(screen.getByText(view.sub.text)).toBeInTheDocument();
      expect(innermostIncluding(view.sub.text).classList.contains('text-warning-fg')).toBe(false);
      if (view.progress === null) throw new TypeError('paper in progress has progress');
      expect(screen.getByText(view.progress.text)).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();

      const button = screen.getByRole('link', { name: view.action.label });
      expect(button.getAttribute('href')).toBe(view.action.href);
      expect(button.getAttribute('data-slot')).toBe('button');
      expect(button.getAttribute('data-size')).toBe('sm');
      expect(button.getAttribute('data-variant')).toBe(view.action.variant);
      expect(button.classList.contains('shrink-0')).toBe(true);

      const rowLink = innermostIncluding(row.title).closest('a');
      if (!(rowLink instanceof HTMLAnchorElement)) throw new TypeError('the row title is not inside a link');
      expect(rowLink.getAttribute('href')).toBe(row.href);
      expect(rowLink.contains(button)).toBe(false);

      navigated.length = 0;
      await user.click(button);
      expect(navigated).toEqual([button]);
    } finally {
      window.removeEventListener('click', onClick, true);
    }
  });

  it('advances the countdown by one second', async () => {
    pinClock(NOW);
    await renderRow(paperRow());
    await flushClock();
    expect(screen.getByText(/01:12:30/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SECOND_MS);
    });
    expect(screen.getByText(/01:12:29/)).toBeInTheDocument();
  });

  it('colors the countdown by the five-minute and one-minute boundaries', async () => {
    pinClock(NOW);
    const samples: { remainingMs: number; tone: CountdownTone }[] = [
      { remainingMs: FIVE_MIN_MS + SECOND_MS, tone: 'text-fg' },
      { remainingMs: FIVE_MIN_MS, tone: 'text-warning-fg' },
      { remainingMs: ONE_MIN_MS + SECOND_MS, tone: 'text-warning-fg' },
      { remainingMs: ONE_MIN_MS, tone: 'text-danger-fg' },
    ];
    for (const sample of samples) {
      const row = paperRow({ personalEndAt: new Date(NOW + sample.remainingMs).toISOString() });
      const view = await renderRow(row);
      await flushClock();
      expectCountdown(clockText(sample.remainingMs), sample.tone);
      view.unmount();
    }
  });

  it('mutes the title when the row is done', async () => {
    pinClock(SKEW);
    const row = paperRow({
      title: DONE_TITLE,
      finalized: true,
      done: true,
      progress: { answered: 20 },
    });
    await renderRow(row);
    await flushClock();
    expect(innermostIncluding(DONE_TITLE).classList.contains('text-fg-muted')).toBe(true);
  });

  it('omits the button when the view has no action', async () => {
    pinClock(SKEW);
    const row = paperRow({ id: NO_ACTION_ID, title: '没有按钮的试卷' });
    const view = studentSetRowView(row, NOW);
    expect(view.action).toBeNull();
    const rendered = await renderRow(row);
    await flushClock();
    expect(rendered.container.querySelector('[data-slot="button"]')).toBeNull();
    const links = within(rendered.container).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(row.href);
  });

  it('truncates the title with min-w-0 at a 360px viewport', async () => {
    pinClock(SKEW);
    applyViewport(360);
    const row = paperRow({ title: LONG_TITLE });
    await renderRow(row);
    await flushClock();
    const title = innermostIncluding(LONG_TITLE);
    expect(window.innerWidth).toBe(360);
    expect(title.classList.contains('min-w-0')).toBe(true);
    expect(title.classList.contains('truncate')).toBe(true);
  });

  it('paints a warning sub in text-warning-fg', async () => {
    pinClock(SKEW);
    const row = homeworkPastDue();
    const view = studentSetRowView(row, NOW);
    if (view.sub === null || view.sub.tone !== 'warning') throw new TypeError('overdue homework has a warning sub');
    await renderRow(row);
    await flushClock();
    expect(innermostIncluding(view.sub.text).classList.contains('text-warning-fg')).toBe(true);
  });

  it('adds a progress bar on a practice row', async () => {
    pinClock(SKEW);
    const row = practiceRow();
    const view = studentSetRowView(row, NOW);
    if (view.progress === null || view.progress.ratio === null) throw new TypeError('practice progress has a ratio');
    await renderRow(row);
    await flushClock();
    expect(screen.getByText(view.progress.text)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe(String(Math.round(view.progress.ratio * 100)));
  });
});
