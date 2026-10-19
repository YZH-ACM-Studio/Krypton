// A static import fails collection while src/pages/problem-sets/list.tsx is absent.
import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import {
  endedResultText,
  formatDate,
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
    urls: { home: '/', training: '/problem-sets' } as KryptonBootstrap['urls'],
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

function headerTab(label: string): HTMLElement {
  const found = within(pageHeader()).getAllByRole('tab').find((tab) => compactText(tab).startsWith(label));
  if (!found) throw new TypeError(`missing tab ${label}`);
  return found;
}

function searchParamsOf(element: Element): URLSearchParams {
  const href = element.getAttribute('href');
  if (href === null || href === '') throw new TypeError('expected a link href');
  return new URL(href, 'http://krypton.test/problem-sets').searchParams;
}

function expectPageTabs(selected: StudentSetsTab, counts: StudentSetsBody['counts']): void {
  expect(within(pageHeader()).getAllByRole('tab')).toHaveLength(4);
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
    const exam = screen.getByRole('tab', { name: '考试' });
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
    expect(searchParamsOf(screen.getByRole('tab', { name: '考试' })).get('type')).toBe('exam');
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
