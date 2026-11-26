// A static import fails collection while src/pages/problem-sets/list.tsx is absent.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { calendarHeadline, monthGrid } from '../../src/pages/problem-sets/calendar-layout.ts';
import {
  endedResultText,
  formatDate,
  schoolWeekStart,
  studentCalendarUrl,
  type ContestRow,
  type EndedRow,
  type PracticeRow,
  type StudentSetsBody,
  type StudentSetsTab,
  type TeamRow,
} from '../../src/pages/problem-sets/model.ts';

const pageLoaders = import.meta.glob('../../src/pages/problem-sets/list.tsx');
const PAGE_SOURCE = 'src/pages/problem-sets/list.tsx';

const GENERATED_AT = '2025-06-15T06:00:00.000Z';
const SERVER_NOW = Date.parse(GENERATED_AT);
const SAME_YEAR_END = '2025-03-02T02:00:00.000Z';
const OTHER_YEAR_END = '2026-03-02T02:00:00.000Z';
const BEGIN_AT = '2026-10-18T00:00:00.000Z';
const END_AT = '2026-10-18T10:00:00.000Z';
const ENDED_PAGE_SIZE = 20;
const PRACTICE_QUERY = '图论';
const ENDED_QUERY = '期中';
const DOT = ' \u00B7 ';
const RUNNING_EMPTY = '现在没有要做的题目集';
const RUNNING_EMPTY_DETAIL = '老师布置作业或考试开始后会出现在这里。';
const UPCOMING_EMPTY = '近期没有安排';
const UPCOMING_EMPTY_DETAIL = '有新的考试或作业时会出现在这里。';
const PRACTICE_EMPTY = '还没有练习';
const ENDED_EMPTY = '没有已结束的题目集';
const SEPARATOR = '已完成';
const SEPARATOR_CLASSES = ['text-xs', 'text-fg-subtle', 'bg-surface-sunken'] as const;

const TEAM_TITLE = '校赛组队';
const OPEN_HOMEWORK_TITLE = '链表作业';
const DONE_EXAM_TITLE = '期中试卷';
const OPEN_UPCOMING_TITLE = '下周模拟赛';
const DONE_UPCOMING_TITLE = '已做完的预习作业';
const PRACTICE_TITLE = '指针专项练习';
const ABSENT_TITLE = '春季试卷';
const HIDDEN_TITLE = '寒假作业';
const ACCEPTED_TITLE = '校赛';
const SCORE_TITLE = '期末选拔';

type PageComponent = () => ReactElement;

interface CountedTab {
  value: 'running' | 'upcoming' | 'practice';
  label: string;
}

const COUNTED_TABS: readonly CountedTab[] = [
  { value: 'running', label: '进行中' },
  { value: 'upcoming', label: '即将开始' },
  { value: 'practice', label: '练习' },
];

function readField(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function isPage(value: unknown): value is PageComponent {
  return typeof value === 'function';
}

async function loadPage(): Promise<PageComponent> {
  const load = Object.values(pageLoaders).find((item) => typeof item === 'function');
  expect(typeof load, `${PAGE_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PAGE_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${PAGE_SOURCE} must be a module`);
  const component = readField(imported, 'StudentSetsPage');
  expect(typeof component, 'StudentSetsPage').toBe('function');
  if (!isPage(component)) throw new TypeError('StudentSetsPage must be a function');
  return component;
}

function pageBootstrap(data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: GENERATED_AT,
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { records: '/record', home: '/', training: '/problem-sets' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'student_sets.html', data },
  };
}

function renderPage(Page: PageComponent, data: unknown) {
  window.history.replaceState(null, '', '/problem-sets');
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(data)}>
      <Page />
    </BootstrapProvider>,
  );
}

function setsBody(tab: StudentSetsTab, overrides: Partial<StudentSetsBody> = {}): StudentSetsBody {
  return {
    counts: { running: 0, upcoming: 0, practice: 0 },
    rows: [],
    practice: tab === 'practice' ? { page: 1, pageCount: 1, q: '' } : null,
    ended: tab === 'ended'
      ? { rows: [], page: 1, pageCount: 1, total: 0, type: 'all', q: '' }
      : null,
    ...overrides,
    tab,
  };
}

function contestRow(overrides: Partial<ContestRow> & Pick<ContestRow, 'id' | 'title' | 'href' | 'done'>): ContestRow {
  return {
    kind: 'exam',
    flavor: 'paper',
    beginAt: BEGIN_AT,
    endAt: END_AT,
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: false,
    clientRequired: false,
    team: false,
    problemCount: 4,
    progress: null,
    finalized: false,
    ...overrides,
  };
}

function teamRow(): TeamRow {
  return {
    kind: 'team',
    id: 'batch-open',
    title: TEAM_TITLE,
    href: '/teams/batch-open',
    description: '每队 1–3 人',
    myState: 'none',
    inviteCount: 0,
    memberCount: null,
  };
}

function practiceRow(): PracticeRow {
  return {
    kind: 'practice',
    description: '练习简介',
    enrolled: true,
    participantCount: 12,
    sourceLabels: ['课程'],
    stages: [{ id: 1, title: '阶段一', status: 'open' as const }],
    id: '64b8000000000000000000b1',
    title: PRACTICE_TITLE,
    href: '/problem-sets/64b8000000000000000000b1',
    stageCount: 3,
    problemCount: 12,
    doneCount: 1,
    sourceLabel: '课程',
  };
}

function endedRow(overrides: Pick<EndedRow, 'id' | 'title' | 'href' | 'kind' | 'flavor' | 'endAt' | 'result'>): EndedRow {
  return overrides;
}

function compactText(node: HTMLElement): string {
  return (node.textContent ?? '').replace(/\s+/g, '');
}

function pageHeader(): HTMLElement {
  const header = screen.getByRole('heading', { level: 1, name: '题目集' }).closest('header');
  if (!(header instanceof HTMLElement)) throw new TypeError('page header is missing');
  return header;
}

function setsTablist(): HTMLElement {
  return within(pageHeader()).getByRole('tablist', { name: '题目集' });
}

function headerTab(label: string): HTMLElement {
  const found = within(setsTablist()).getAllByRole('tab').find((tab) => compactText(tab).startsWith(label));
  if (!found) throw new TypeError(`missing tab ${label}`);
  return found;
}

function searchParamsOf(element: Element): URLSearchParams {
  const href = element.getAttribute('href');
  if (href === null || href === '') throw new TypeError('expected a link href');
  return new URL(href, 'http://krypton.test/problem-sets').searchParams;
}

function expectPageTabs(selected: StudentSetsTab, counts: StudentSetsBody['counts']): void {
  expect(within(setsTablist()).getAllByRole('tab')).toHaveLength(4);
  for (const tab of COUNTED_TABS) {
    const node = headerTab(tab.label);
    expect(node.tagName).toBe('A');
    expect(searchParamsOf(node).get('tab')).toBe(tab.value);
    expect(node).toHaveAttribute('aria-selected', tab.value === selected ? 'true' : 'false');
    expect(compactText(node)).toBe(`${tab.label}${counts[tab.value]}`);
  }
  const ended = headerTab('已结束');
  expect(ended.tagName).toBe('A');
  expect(searchParamsOf(ended).get('tab')).toBe('ended');
  expect(ended).toHaveAttribute('aria-selected', selected === 'ended' ? 'true' : 'false');
  expect(compactText(ended)).toBe('已结束');
}

function expectNoPrimary(): void {
  const primary = [...document.querySelectorAll('[data-variant="primary"]')].filter((node) => node instanceof HTMLElement);
  expect(primary).toHaveLength(0);
}

function expectBefore(earlier: HTMLElement, later: HTMLElement): void {
  expect(earlier.compareDocumentPosition(later)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
}

function hasSeparatorClasses(node: HTMLElement): boolean {
  for (const name of SEPARATOR_CLASSES) {
    if (!node.classList.contains(name)) return false;
  }
  return true;
}

function expectSeparator(label: HTMLElement): void {
  let current: HTMLElement | null = label;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (hasSeparatorClasses(current)) return;
    current = current.parentElement;
  }
  expect(label).toHaveClass(...SEPARATOR_CLASSES);
}

function expectHref(href: string): void {
  expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
}

function formOf(input: HTMLElement): HTMLFormElement {
  const form = input.closest('form');
  if (!(form instanceof HTMLFormElement)) throw new TypeError('search input is not in a form');
  return form;
}

function hiddenValue(form: HTMLFormElement, name: string): string | null {
  const input = form.querySelector(`input[type="hidden"][name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) return null;
  return input.value;
}

function runningRows(): StudentSetsBody['rows'] {
  return [
    teamRow(),
    contestRow({
      kind: 'homework',
      flavor: 'homework',
      id: '64b8000000000000000000a2',
      title: OPEN_HOMEWORK_TITLE,
      href: '/homework/64b8000000000000000000a2',
      done: false,
      progress: { answered: 1 },
    }),
    contestRow({
      id: '64b8000000000000000000a1',
      title: DONE_EXAM_TITLE,
      href: '/contest/64b8000000000000000000a1',
      done: true,
      finalized: true,
      attended: true,
    }),
  ];
}

function endedRows(): EndedRow[] {
  return [
    endedRow({
      kind: 'exam',
      flavor: 'paper',
      id: '64b800000000000000000011',
      title: ABSENT_TITLE,
      href: '/contest/64b800000000000000000011',
      endAt: SAME_YEAR_END,
      result: { kind: 'absent' },
    }),
    endedRow({
      kind: 'homework',
      flavor: 'homework',
      id: '64b800000000000000000012',
      title: HIDDEN_TITLE,
      href: '/homework/64b800000000000000000012',
      endAt: OTHER_YEAR_END,
      result: { kind: 'hidden' },
    }),
    endedRow({
      kind: 'exam',
      flavor: 'acm',
      id: '64b800000000000000000013',
      title: ACCEPTED_TITLE,
      href: '/contest/64b800000000000000000013',
      endAt: SAME_YEAR_END,
      result: { kind: 'accepted', accepted: 3 },
    }),
    endedRow({
      kind: 'exam',
      flavor: 'ioi',
      id: '64b800000000000000000014',
      title: SCORE_TITLE,
      href: '/contest/64b800000000000000000014',
      endAt: OTHER_YEAR_END,
      result: { kind: 'score', score: 88 },
    }),
  ];
}

function endedSummary(page: number, total: number): string {
  const start = (page - 1) * ENDED_PAGE_SIZE + 1;
  const end = Math.min(page * ENDED_PAGE_SIZE, total);
  return `第 ${start}\u2013${end} 项，共 ${total} 项`;
}

describe('student sets list page', () => {
  it('places finished running rows under the separator and reads counts from the payload', async () => {
    const Page = await loadPage();
    const counts = { running: 9, upcoming: 0, practice: 4 };
    const rows = runningRows();
    renderPage(Page, setsBody('running', { counts, rows }));

    expectPageTabs('running', counts);
    const openTeam = screen.getByText(TEAM_TITLE);
    const openHomework = screen.getByText(OPEN_HOMEWORK_TITLE);
    const doneExam = screen.getByText(DONE_EXAM_TITLE);
    const separator = screen.getByText(SEPARATOR);
    expectSeparator(separator);
    expectBefore(openTeam, openHomework);
    expectBefore(openHomework, separator);
    expectBefore(separator, doneExam);
    expectHref('/teams/batch-open');
    expectHref('/homework/64b8000000000000000000a2');
    expectHref('/contest/64b8000000000000000000a1');
    expect(screen.queryByPlaceholderText('搜索练习')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '我的成绩' })).toBeNull();
    expectNoPrimary();
  });

  it('places finished upcoming rows under the same separator', async () => {
    const Page = await loadPage();
    const rows = [
      contestRow({
        id: '64b8000000000000000000c1',
        title: OPEN_UPCOMING_TITLE,
        href: '/contest/64b8000000000000000000c1',
        flavor: 'acm',
        done: false,
      }),
      contestRow({
        kind: 'homework',
        flavor: 'homework',
        id: '64b8000000000000000000c2',
        title: DONE_UPCOMING_TITLE,
        href: '/homework/64b8000000000000000000c2',
        done: true,
        progress: { answered: 4 },
      }),
    ];
    renderPage(Page, setsBody('upcoming', { counts: { running: 2, upcoming: 2, practice: 1 }, rows }));

    const openRow = screen.getByText(OPEN_UPCOMING_TITLE);
    const doneRow = screen.getByText(DONE_UPCOMING_TITLE);
    const separator = screen.getByText(SEPARATOR);
    expectSeparator(separator);
    expectBefore(openRow, separator);
    expectBefore(separator, doneRow);
    expect(screen.queryByText(RUNNING_EMPTY)).toBeNull();
    expect(screen.queryByText(UPCOMING_EMPTY)).toBeNull();
  });

  it('shows the running empty copy', async () => {
    const Page = await loadPage();
    const counts = { running: 0, upcoming: 1, practice: 2 };
    renderPage(Page, setsBody('running', { counts }));

    expectPageTabs('running', counts);
    expect(screen.getByText(RUNNING_EMPTY)).toBeInstanceOf(HTMLElement);
    expect(screen.getByText(RUNNING_EMPTY_DETAIL)).toBeInstanceOf(HTMLElement);
    expect(screen.queryByText(SEPARATOR)).toBeNull();
    expect(screen.queryByText(UPCOMING_EMPTY)).toBeNull();
    expectNoPrimary();
  });

  it('shows the upcoming empty copy', async () => {
    const Page = await loadPage();
    const counts = { running: 0, upcoming: 0, practice: 3 };
    renderPage(Page, setsBody('upcoming', { counts }));

    expectPageTabs('upcoming', counts);
    expect(screen.getByText(UPCOMING_EMPTY)).toBeInstanceOf(HTMLElement);
    expect(screen.getByText(UPCOMING_EMPTY_DETAIL)).toBeInstanceOf(HTMLElement);
    expect(screen.queryByText(SEPARATOR)).toBeNull();
    expect(screen.queryByText(RUNNING_EMPTY)).toBeNull();
    expectNoPrimary();
  });

  it('searches practice with a hidden tab field and paginates past the first page', async () => {
    const Page = await loadPage();
    const row = practiceRow();
    const counts = { running: 1, upcoming: 1, practice: 6 };
    renderPage(Page, setsBody('practice', {
      counts,
      rows: [row],
      practice: { page: 2, pageCount: 3, q: PRACTICE_QUERY },
    }));

    expectPageTabs('practice', counts);
    expect(screen.getByText(PRACTICE_TITLE)).toBeInstanceOf(HTMLElement);
    expectHref(row.href);
    const search = screen.getByPlaceholderText('搜索练习');
    expect(search).toHaveAttribute('name', 'q');
    expect(search).toHaveValue(PRACTICE_QUERY);
    const form = formOf(search);
    expect((form.getAttribute('method') ?? 'get').toLowerCase()).toBe('get');
    expect(hiddenValue(form, 'tab')).toBe('practice');
    const nav = screen.getByRole('navigation', { name: 'pagination' });
    const previous = within(nav).getByRole('link', { name: '上一页' });
    const next = within(nav).getByRole('link', { name: '下一页' });
    expect(searchParamsOf(previous).get('page')).toBe('1');
    expect(searchParamsOf(next).get('page')).toBe('3');
    for (const link of [previous, next]) {
      expect(searchParamsOf(link).get('tab')).toBe('practice');
      expect(searchParamsOf(link).get('q')).toBe(PRACTICE_QUERY);
    }
    expect(screen.queryByText(PRACTICE_EMPTY)).toBeNull();
    expectNoPrimary();
  });

  it('shows each practice card with its own progress including untouched and completed sets', async () => {
    const Page = await loadPage();
    const rows = [0, 2, 4].map((doneCount) => ({
      ...practiceRow(), id: `practice-${doneCount}`, title: `练习 ${doneCount}`,
      href: `/problem-sets/practice-${doneCount}`, problemCount: 4, doneCount,
    }));
    renderPage(Page, setsBody('practice', { rows }));
    for (const row of rows) {
      const card = screen.getByRole('link', { name: new RegExp(row.title) });
      expect(card).toHaveAttribute('href', row.href);
      expect(within(card).getByRole('heading', { name: row.title })).toBeInTheDocument();
      expect(within(card).getByText('进度')).toBeInTheDocument();
      expect(within(card).getByText(`${row.doneCount}/4 · ${row.doneCount * 25}%`)).toBeInTheDocument();
      expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(row.doneCount * 25));
    }
    expect(within(screen.getByRole('link', { name: /练习 4/ })).getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the practice empty copy and hides pagination on a single page', async () => {
    const Page = await loadPage();
    renderPage(Page, setsBody('practice', {
      counts: { running: 0, upcoming: 0, practice: 0 },
      practice: { page: 1, pageCount: 1, q: '' },
    }));

    expect(screen.getByText(PRACTICE_EMPTY)).toBeInstanceOf(HTMLElement);
    const search = screen.getByPlaceholderText('搜索练习');
    expect(search).toHaveAttribute('name', 'q');
    expect(hiddenValue(formOf(search), 'tab')).toBe('practice');
    expect(screen.queryByRole('navigation', { name: 'pagination' })).toBeNull();
    expectNoPrimary();
  });

  it('links ended type filters to type=exam and renders one table row per ended row', async () => {
    const Page = await loadPage();
    const rows = endedRows();
    const page = 2;
    const total = 24;
    const counts = { running: 3, upcoming: 1, practice: 8 };
    renderPage(Page, setsBody('ended', {
      counts,
      rows: [],
      ended: { rows, page, pageCount: 2, total, type: 'all', q: ENDED_QUERY },
    }));

    expectPageTabs('ended', counts);
    const exam = screen.getByRole('tab', { name: '考试及比赛' });
    const homework = screen.getByRole('tab', { name: '作业' });
    const all = screen.getByRole('tab', { name: '全部' });
    expect(exam.tagName).toBe('A');
    expect(searchParamsOf(exam).get('tab')).toBe('ended');
    expect(searchParamsOf(exam).get('type')).toBe('exam');
    expect(searchParamsOf(exam).get('q')).toBe(ENDED_QUERY);
    expect(searchParamsOf(homework).get('type')).toBe('homework');
    expect(searchParamsOf(homework).get('q')).toBe(ENDED_QUERY);
    expect(searchParamsOf(all).get('type')).toBe('all');
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(exam).toHaveAttribute('aria-selected', 'false');

    const search = screen.getByPlaceholderText('搜索标题');
    expect(search).toHaveAttribute('name', 'q');
    expect(search).toHaveValue(ENDED_QUERY);
    expect((formOf(search).getAttribute('method') ?? 'get').toLowerCase()).toBe('get');

    const tableRoot = document.querySelector('[data-slot="data-table"]');
    if (!(tableRoot instanceof HTMLElement)) throw new TypeError('ended table is missing');
    expect(tableRoot).toHaveAttribute('data-mobile', 'stack');
    const table = tableRoot.querySelector('table');
    if (!(table instanceof HTMLTableElement)) throw new TypeError('ended table is missing');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(rows.length);
    for (const header of ['类型', '标题', '结束', '我的成绩']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInstanceOf(HTMLElement);
    }
    expect(screen.getByRole('columnheader', { name: '我的成绩' })).toHaveClass('text-right');
    for (const row of rows) {
      expect(screen.getAllByText(row.title).length).toBeGreaterThan(0);
      expect(table.querySelector(`a[href="${row.href}"]`)).not.toBeNull();
      if (row.result.kind === 'score' || row.result.kind === 'accepted') {
        const href = `/record?tid=${row.id}&uidOrName=7`;
        expect(Array.from(table.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toContain(href);
        expect(Array.from(tableRoot.querySelectorAll('ul a')).map((link) => link.getAttribute('href'))).toContain(href);
      }
      expect(screen.getAllByText(endedResultText(row.result)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(formatDate(row.endAt, SERVER_NOW)).length).toBeGreaterThan(0);
    }
    expect(within(table).getAllByText(`考试${DOT}试卷`).length).toBeGreaterThan(0);
    expect(within(table).getAllByText('作业').length).toBeGreaterThan(0);
    expect(within(table).getAllByText(`考试${DOT}ACM`).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(`考试${DOT}IOI`).length).toBeGreaterThan(0);
    for (const muted of ['未参加', '未公布']) {
      const marks = screen.getAllByText(muted).filter((mark) => mark.childElementCount === 0);
      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) {
        expect(mark).toHaveClass('text-fg-subtle');
      }
    }
    const nav = screen.getByRole('navigation', { name: 'pagination' });
    expect(nav).toHaveTextContent(endedSummary(page, total));
    const previous = within(nav).getByRole('link', { name: '上一页' });
    expect(searchParamsOf(previous).get('tab')).toBe('ended');
    expect(searchParamsOf(previous).get('type')).toBe('all');
    expect(searchParamsOf(previous).get('q')).toBe(ENDED_QUERY);
    expect(searchParamsOf(previous).get('page')).toBe('1');
    expect(screen.queryByText(ENDED_EMPTY)).toBeNull();
    expect(screen.queryByText(SEPARATOR)).toBeNull();
    expectNoPrimary();
  });

  it('shows the ended empty copy without a single-page pager', async () => {
    const Page = await loadPage();
    renderPage(Page, setsBody('ended', {
      counts: { running: 0, upcoming: 0, practice: 0 },
      ended: { rows: [], page: 1, pageCount: 1, total: 0, type: 'all', q: '' },
    }));

    expect(screen.getAllByText(ENDED_EMPTY).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('搜索标题')).toHaveAttribute('name', 'q');
    expect(searchParamsOf(screen.getByRole('tab', { name: '考试及比赛' })).get('type')).toBe('exam');
    expect(screen.queryByRole('navigation', { name: 'pagination' })).toBeNull();
    expectNoPrimary();
  });

  it('rejects a payload that is missing counts', async () => {
    const Page = await loadPage();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => {
        renderPage(Page, { tab: 'running', rows: [], practice: null, ended: null });
      }).toThrow(TypeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});

const CALENDAR_NOW = '2026-10-21T06:32:00.000Z';
const CALENDAR_NOW_MS = Date.parse(CALENDAR_NOW);
const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_WEEK_MS = 7 * CALENDAR_DAY_MS;
const VIEW_KEY = 'krypton:problem-sets-view';
const CHAPTER_TITLE = '第三章';
const CALENDAR_ERROR = '日历暂时打不开。';
const CALENDAR_FOOTER = '练习没有时间，不在日历里；去「列表 › 练习」查看。组队没有时间，留在「列表 › 进行中」置顶。';
const NEXT_WEEK = '\u203A';

function calendarChapter(): ContestRow {
  return {
    kind: 'homework',
    id: 'chapter-3',
    flavor: 'homework',
    title: CHAPTER_TITLE,
    href: '/homework/chapter-3',
    beginAt: '2026-10-20T00:00:00.000Z',
    endAt: '2026-10-22T04:00:00.000Z',
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: true,
    clientRequired: false,
    team: false,
    problemCount: 6,
    progress: { answered: 1 },
    finalized: false,
    done: false,
  };
}

function calendarWeekBounds(offset: number): { from: number; to: number } {
  const from = schoolWeekStart(CALENDAR_NOW_MS) + offset * CALENDAR_WEEK_MS;
  return { from, to: from + CALENDAR_WEEK_MS };
}

function calendarRequestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  return new URL(input.url, 'http://krypton.local');
}

function calendarJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function calendarHttpError(message: string, status: number): Response {
  return calendarJson({
    error: {
      name: 'InternalError',
      errorCode: 'InternalError',
      code: status,
      status,
      params: [],
      message,
    },
  }, status);
}

function calendarBound(url: URL, key: 'from' | 'to'): string {
  const value = url.searchParams.get(key);
  if (value === null) throw new TypeError(`calendar request is missing ${key}`);
  return value;
}

function expectCalendarBounds(url: URL, fromMs: number, toMs: number): void {
  const expected = new URL(studentCalendarUrl(fromMs, toMs), 'http://krypton.local');
  expect(url.pathname).toBe('/problem-sets');
  expect(url.searchParams.get('view')).toBe('calendar');
  expect(url.searchParams.get('from')).toBe(expected.searchParams.get('from'));
  expect(url.searchParams.get('to')).toBe(expected.searchParams.get('to'));
}

function calendarBodyText(): string {
  return document.body.textContent ?? '';
}

function expectCalendarRemaining(count: number | null): void {
  const body = calendarBodyText();
  if (count === null) {
    expect(body).not.toMatch(/还有\s*\d+\s*项没完成/);
    return;
  }
  expect(body).toMatch(new RegExp(`还有\\s*${count}\\s*项没完成`));
}

function calendarMediaMatches(query: string, width: number): boolean {
  const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
  const minText = minWidth?.[1];
  if (minText !== undefined) return width >= Number(minText);
  const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(query);
  const maxText = maxWidth?.[1];
  if (maxText !== undefined) return width <= Number(maxText);
  return false;
}

type MediaChange = (event: MediaQueryListEvent) => void;

interface LiveMediaQuery {
  matches: boolean;
  listeners: Set<MediaChange>;
}

const SM_QUERY = '(min-width: 640px)';

describe('student sets calendar view', () => {
  const calls: URL[] = [];
  let failAt: number | null = null;
  let rowsForCall: (call: number) => readonly ContestRow[] = () => [calendarChapter()];
  let user = userEvent.setup();
  const originalMatchMedia = window.matchMedia;
  const mediaQueries = new Map<string, LiveMediaQuery>();
  let viewportWidth = 1280;

  function liveMediaQuery(query: string): LiveMediaQuery {
    const matches = calendarMediaMatches(query, viewportWidth);
    const existing = mediaQueries.get(query);
    if (existing) {
      existing.matches = matches;
      return existing;
    }
    const created: LiveMediaQuery = { matches, listeners: new Set() };
    mediaQueries.set(query, created);
    return created;
  }

  function rememberMediaChange(live: LiveMediaQuery, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener !== 'function') return;
    live.listeners.add(listener as MediaChange);
  }

  function forgetMediaChange(live: LiveMediaQuery, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener !== 'function') return;
    live.listeners.delete(listener as MediaChange);
  }

  function callAt(index: number): URL {
    const url = calls[index];
    if (!(url instanceof URL)) throw new TypeError(`missing calendar request ${index + 1}`);
    return url;
  }

  // setup.ts reports every media query as unmatched, so useBreakpoint('sm') stays false until this runs.
  function installViewport(width: number): void {
    viewportWidth = width;
    mediaQueries.clear();
    window.matchMedia = ((query: string) => {
      const live = liveMediaQuery(query);
      return {
        get matches() {
          return live.matches;
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
          rememberMediaChange(live, listener);
        },
        removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
          forgetMediaChange(live, listener);
        },
        dispatchEvent: vi.fn(() => false),
      };
    }) as unknown as typeof window.matchMedia;
  }

  // useBreakpoint keeps the list it subscribed at mount. Replacing matchMedia does not emit change.
  async function narrowBelowSm(): Promise<void> {
    const live = mediaQueries.get(SM_QUERY);
    if (live === undefined || live.listeners.size === 0) {
      throw new TypeError(`no change listener registered for ${SM_QUERY}`);
    }
    viewportWidth = 500;
    live.matches = false;
    const event = { matches: false, media: SM_QUERY } as MediaQueryListEvent;
    const listeners = [...live.listeners];
    await act(async () => {
      for (const listener of listeners) listener(event);
    });
  }

  function installStorage(seed: Record<string, string> = {}, broken?: 'get' | 'set'): void {
    const store = new Map(Object.entries(seed));
    const storage: Storage = {
      getItem: (key) => {
        if (broken === 'get') throw new Error(`storage denied ${key}`);
        return store.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (broken === 'set') throw new Error(`storage denied ${key}`);
        store.set(key, String(value));
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    };
    vi.stubGlobal('localStorage', storage);
  }

  function installFetch(): void {
    calls.length = 0;
    let calendarCall = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = calendarRequestUrl(input);
      if (url.pathname !== '/problem-sets' || url.searchParams.get('view') !== 'calendar') {
        return Promise.resolve(calendarJson({}));
      }
      calendarCall += 1;
      calls.push(url);
      if (failAt === calendarCall) return Promise.resolve(calendarHttpError(CALENDAR_ERROR, 500));
      return Promise.resolve(calendarJson({
        view: 'calendar',
        from: calendarBound(url, 'from'),
        to: calendarBound(url, 'to'),
        rows: rowsForCall(calendarCall),
      }));
    }));
  }

  function renderSets(Page: PageComponent, hash = '') {
    const suffix = hash === '' ? '' : (hash.startsWith('#') ? hash : `#${hash}`);
    window.history.replaceState(null, '', `/problem-sets${suffix}`);
    const bootstrap = pageBootstrap(setsBody('running', {
      counts: { running: 3, upcoming: 0, practice: 1 },
      rows: runningRows(),
    }));
    bootstrap.generatedAt = CALENDAR_NOW;
    return render(
      <BootstrapProvider bootstrap={bootstrap}>
        <Page />
      </BootstrapProvider>,
    );
  }

  beforeEach(() => {
    failAt = null;
    rowsForCall = () => [calendarChapter()];
    user = userEvent.setup();
    installViewport(1280);
    installStorage();
    installFetch();
    window.history.replaceState(null, '', '/problem-sets');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.history.replaceState(null, '', '/problem-sets');
  });

  it('opens the calendar from the header and remembers that choice', async () => {
    const Page = await loadPage();
    renderSets(Page);

    expect(screen.getByRole('tab', { name: /进行中/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /即将开始/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /练习/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '已结束' })).toBeInTheDocument();
    expect(screen.getByText(OPEN_HOMEWORK_TITLE)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(screen.getByRole('tab', { name: '列表' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: '日历' }));
    expect(localStorage.getItem(VIEW_KEY)).toBe('calendar');
    expect(screen.getByRole('tab', { name: '日历' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /即将开始/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /练习/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: '已结束' })).toBeNull();
    expect(screen.queryByText(OPEN_HOMEWORK_TITLE)).toBeNull();
    await waitFor(() => expect(calls).toHaveLength(1));
    expectCalendarBounds(callAt(0), calendarWeekBounds(0).from, calendarWeekBounds(0).to);
    expect(await screen.findByText(CHAPTER_TITLE)).toBeInTheDocument();
    expect(calendarBodyText()).toContain(CALENDAR_FOOTER);
    const bounds = calendarWeekBounds(0);
    const headline = calendarHeadline([calendarChapter()], 'week', 0, bounds.from, bounds.to, CALENDAR_NOW_MS);
    expect(calendarBodyText()).toContain(headline.caption);
    expect(calendarBodyText()).toContain(headline.relative);
  });

  it('opens the calendar from the hash even when the saved choice is the list', async () => {
    installStorage({ [VIEW_KEY]: 'list' });
    const Page = await loadPage();
    renderSets(Page, '#calendar');

    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    expect(screen.queryByText(OPEN_HOMEWORK_TITLE)).toBeNull();
    expect(screen.getByRole('tab', { name: '日历' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(calls).toHaveLength(1));
    expectCalendarBounds(callAt(0), calendarWeekBounds(0).from, calendarWeekBounds(0).to);
    expect(calendarBodyText()).toContain(CALENDAR_FOOTER);
  });

  it('opens the calendar when that choice was saved', async () => {
    installStorage({ [VIEW_KEY]: 'calendar' });
    const Page = await loadPage();
    renderSets(Page);

    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    expect(screen.getByRole('tab', { name: '日历' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(calls).toHaveLength(1));
    expectCalendarBounds(callAt(0), calendarWeekBounds(0).from, calendarWeekBounds(0).to);
  });

  it('stays on the list when the saved choice cannot be read', async () => {
    installStorage({}, 'get');
    const Page = await loadPage();
    renderSets(Page);

    expect(screen.getByRole('tab', { name: '列表' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /进行中/ })).toBeInTheDocument();
    expect(screen.getByText(OPEN_HOMEWORK_TITLE)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('still opens the calendar when saving the choice throws', async () => {
    installStorage({}, 'set');
    const Page = await loadPage();
    renderSets(Page);

    await user.click(screen.getByRole('tab', { name: '日历' }));
    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    await waitFor(() => expect(calls).toHaveLength(1));
    expectCalendarBounds(callAt(0), calendarWeekBounds(0).from, calendarWeekBounds(0).to);
  });

  it('requests the next week and can return to this week', async () => {
    rowsForCall = (call) => (call === 2 ? [] : [calendarChapter()]);
    const Page = await loadPage();
    renderSets(Page, '#calendar');
    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    await screen.findByText(CHAPTER_TITLE);

    await user.click(screen.getByRole('button', { name: NEXT_WEEK }));
    await waitFor(() => expect(calls).toHaveLength(2));
    const firstFrom = Date.parse(calendarBound(callAt(0), 'from'));
    const secondFrom = Date.parse(calendarBound(callAt(1), 'from'));
    expect(secondFrom - firstFrom).toBe(CALENDAR_WEEK_MS);
    expectCalendarBounds(callAt(1), calendarWeekBounds(1).from, calendarWeekBounds(1).to);
    const next = calendarWeekBounds(1);
    const nextHeadline = calendarHeadline([], 'week', 1, next.from, next.to, CALENDAR_NOW_MS);
    expect(nextHeadline.relative).toBe('下周');
    expect(calendarBodyText()).toContain(nextHeadline.relative);
    expect(calendarBodyText()).toContain(nextHeadline.caption);
    expectCalendarRemaining(nextHeadline.remaining);

    await user.click(screen.getByRole('button', { name: '今天' }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expectCalendarBounds(callAt(2), calendarWeekBounds(0).from, calendarWeekBounds(0).to);
    expect(calendarBodyText()).toContain('项在本周截止');
  });

  it('requests the month grid and shows the month view', async () => {
    const Page = await loadPage();
    renderSets(Page, '#calendar');
    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    await screen.findByRole('tab', { name: '月' });

    await user.click(screen.getByRole('tab', { name: '月' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    const from = Date.parse(calendarBound(callAt(1), 'from'));
    const to = Date.parse(calendarBound(callAt(1), 'to'));
    const days = (to - from) / CALENDAR_DAY_MS;
    expect(days === 35 || days === 42).toBe(true);
    const grid = monthGrid([calendarChapter()], 0, CALENDAR_NOW_MS);
    expect(from).toBe(grid.fromMs);
    expect(to).toBe(grid.toMs);
    expect(screen.getByRole('grid', { name: '月历' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '本周题目集' })).toBeNull();
    const headline = calendarHeadline([calendarChapter()], 'month', 0, grid.fromMs, grid.toMs, CALENDAR_NOW_MS);
    expect(calendarBodyText()).toContain(headline.caption);
  });

  it('keeps the selected week when the month view narrows below sm', async () => {
    const Page = await loadPage();
    renderSets(Page, '#calendar');
    expect(await screen.findByText(CHAPTER_TITLE)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '月' }));
    expect(await screen.findByRole('grid', { name: '月历' })).toBeInTheDocument();
    await waitFor(() => expect(calls).toHaveLength(2));
    const from = Date.parse(calendarBound(callAt(1), 'from'));
    const to = Date.parse(calendarBound(callAt(1), 'to'));
    const days = (to - from) / CALENDAR_DAY_MS;
    expect(days === 35 || days === 42).toBe(true);
    expect(calendarBodyText()).toContain(CHAPTER_TITLE);

    await narrowBelowSm();

    expect(calendarBodyText()).toContain(CHAPTER_TITLE);
    expect(calendarBodyText()).toContain('本周');
    expect(calendarBodyText()).not.toContain('3 周前');
  });

  it('shows the agenda without the week month switch on a narrow viewport', async () => {
    installViewport(500);
    const Page = await loadPage();
    renderSets(Page, '#calendar');

    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: '周' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '月' })).toBeNull();
    expect(await screen.findByRole('region', { name: '进行中' })).toBeInTheDocument();
    const dueDay = screen.getByRole('region', { name: '周四' });
    expect(dueDay).toHaveTextContent(CHAPTER_TITLE);
    expect(dueDay).toHaveTextContent('截止');
    expect(screen.queryByRole('region', { name: '本周题目集' })).toBeNull();
    expect(screen.queryByRole('grid', { name: '月历' })).toBeNull();
    expect(calls).toHaveLength(1);
    expectCalendarBounds(callAt(0), calendarWeekBounds(0).from, calendarWeekBounds(0).to);
  });

  it('shows a failed calendar request and can return to the list', async () => {
    failAt = 2;
    installStorage({ [VIEW_KEY]: 'calendar' });
    const Page = await loadPage();
    renderSets(Page, '#calendar');
    expect(screen.queryByRole('tab', { name: /进行中/ })).toBeNull();
    expect(await screen.findByText(CHAPTER_TITLE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: NEXT_WEEK }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CALENDAR_ERROR);
    expect(screen.getByText(CHAPTER_TITLE)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '列表' }));
    expect(screen.getByRole('tab', { name: /进行中/ })).toBeInTheDocument();
    expect(screen.getByText(OPEN_HOMEWORK_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(CALENDAR_ERROR)).toBeNull();
    expect(localStorage.getItem(VIEW_KEY)).not.toBe('calendar');
  });
});
