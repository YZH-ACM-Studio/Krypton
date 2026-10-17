// A static import fails collection while problems.tsx is absent.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import type { ProblemKind, TeachTab, TeachType } from '@hydrooj/common';
import type { TeachPaperProblem, TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { paperFromPayload, paperSummary } from '../../src/pages/teach/paper.ts';

const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/problems.tsx');

const TAB_SOURCE = 'src/pages/teach/tabs/problems.tsx';
const EXAM_ID = 'midterm-3';
const HOMEWORK_ID = 'hw-12';
const EDIT_LABEL = '编辑题目';
const EMPTY_SUMMARY = '还没有题目';
const EMPTY_DESCRIPTION = '点「编辑题目」从题库里加题。';
const SUMMARY_CLASS = ['text-sm', 'text-fg-muted', 'tabular'] as const;

interface ProblemsTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function tabLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(tabLoaders)) {
    if (!key.endsWith(TAB_SOURCE)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadProblemsTab(): Promise<ComponentType<ProblemsTabProps>> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('problems tab module must be an object');
  return asComponent<ProblemsTabProps>(readField(imported, 'ProblemsTab'), 'ProblemsTab');
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function problem(fields: {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  score: number;
}): TeachPaperProblem {
  return {
    docId: fields.docId,
    pid: fields.pid,
    title: fields.title,
    kind: fields.kind,
    score: fields.score,
    hidden: false,
    mine: true,
    difficulty: null,
  };
}

function payload(
  type: TeachType,
  id: string,
  rule: string,
  problems: TeachPaperProblem[],
  quotas: Partial<Record<ProblemKind, number>> | null,
): TeachWorkbenchPayload {
  return {
    container: {
      type,
      id,
      rule,
      title: '一次函数测验',
      status: 'upcoming',
      beginAt: '2026-10-16T06:00:00.000Z',
      endAt: '2026-10-16T08:00:00.000Z',
      durationMinutes: null,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'all',
        groupNames: [],
        schoolNames: [],
        boundStudentCount: null,
      },
      owner: { uid: 4, name: '王老师' },
      maintainers: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: {
        studentView: `/contest/${id}`,
        scoreboard: null,
        manage: null,
        users: null,
        clarification: null,
        grading: null,
        teams: null,
        balloon: null,
        print: null,
        code: null,
        files: `/contest/${id}/management`,
        redemption: null,
      },
    },
    paper: {
      problems,
      stages: null,
      examPaperQuotas: quotas,
    },
    stats: {
      participantCount: 0,
      startedCount: null,
      finalizedCount: null,
      submittedCount: null,
      recordCount: null,
      audienceCount: null,
      problemStats: null,
    },
    capabilities: {
      canDelete: true,
      canShare: true,
      canGrade: false,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: false,
    },
  };
}

function summaryOf(value: TeachWorkbenchPayload): string {
  return paperSummary(paperFromPayload(value.paper, value.container));
}

function editLink(): HTMLAnchorElement {
  const link = screen.getByRole('link', { name: EDIT_LABEL });
  if (!(link instanceof HTMLAnchorElement)) throw new TypeError('edit link');
  return link;
}

function toolbarOf(link: HTMLElement): HTMLElement {
  let current: HTMLElement | null = link.parentElement;
  while (current) {
    const tokens = classTokens(current);
    const end = [...current.children].find((node) => classTokens(node).includes('ml-auto'));
    if (tokens.includes('flex') && tokens.includes('items-center') && end instanceof HTMLElement) return current;
    current = current.parentElement;
  }
  throw new TypeError('toolbar');
}

function toolbarEnd(link: HTMLElement): HTMLElement {
  const end = [...toolbarOf(link).children].find((node) => classTokens(node).includes('ml-auto'));
  if (!(end instanceof HTMLElement)) throw new TypeError('toolbar end');
  return end;
}

function expectEditLink(href: string) {
  const link = editLink();
  expect(link).toHaveAttribute('href', href);
  expect(link).toHaveAttribute('data-slot', 'button');
  expect(link).toHaveAttribute('data-variant', 'primary');
  const icons = [...link.querySelectorAll('svg')].filter((node) => classTokens(node).includes('lucide-pen-line'));
  expect(icons).toHaveLength(1);
  return link;
}

function expectSummary(summary: string) {
  const end = toolbarEnd(editLink());
  expect(normalizedText(end)).toBe(summary);
  const styled = [end, ...end.querySelectorAll('*')].find((node) => {
    const tokens = classTokens(node);
    return normalizedText(node) === summary && SUMMARY_CLASS.every((token) => tokens.includes(token));
  });
  expect(styled).toBeInstanceOf(Element);
}

function renderTab(ProblemsTab: ComponentType<ProblemsTabProps>, value: TeachWorkbenchPayload) {
  render(<ProblemsTab payload={value} onNavigateTab={() => undefined} />);
}

function tabByLabel(label: string): HTMLElement {
  const found = screen.getAllByRole('tab').find((tab) => (tab.textContent ?? '').includes(label));
  if (!found) throw new TypeError(`tab ${label}`);
  return found;
}

function rowOf(title: string): HTMLElement {
  const titleNode = screen.getByText(title, { exact: true });
  let current: HTMLElement | null = titleNode.parentElement;
  while (current) {
    const tokens = classTokens(current);
    if (tokens.includes('items-center') && tokens.includes('gap-3')) return current;
    current = current.parentElement;
  }
  throw new TypeError(`row ${title}`);
}

const TRUE_FALSE_A = problem({
  docId: 11,
  pid: 'P1001',
  title: '栈的基本操作',
  kind: 'true_false',
  score: 2,
});
const TRUE_FALSE_B = problem({
  docId: 12,
  pid: 'P1002',
  title: '队列的判断',
  kind: 'true_false',
  score: 2,
});
const SINGLE = problem({
  docId: 21,
  pid: 'P2001',
  title: '循环队列长度',
  kind: 'single',
  score: 2,
});

describe('problems tab', () => {
  it('links 编辑题目 to the exam compose path and shows paperSummary', async () => {
    const value = payload('exam', EXAM_ID, 'exam', [TRUE_FALSE_A, TRUE_FALSE_B, SINGLE], null);
    const summary = summaryOf(value);
    expect(summary.startsWith('共 ')).toBe(true);
    expect(summary).toContain('满分');

    const ProblemsTab = await loadProblemsTab();
    renderTab(ProblemsTab, value);

    expectEditLink(`/teach/exam/${EXAM_ID}/compose`);
    expectSummary(summary);
    expect(screen.getByText(TRUE_FALSE_A.title)).toBeTruthy();
    expect(screen.getByText(TRUE_FALSE_B.title)).toBeTruthy();
    expect(screen.queryByText(SINGLE.title)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('keeps paperSummary while the active kind changes and numbers the whole paper', async () => {
    const user = userEvent.setup();
    const value = payload('exam', EXAM_ID, 'exam', [TRUE_FALSE_A, TRUE_FALSE_B, SINGLE], null);
    const summary = summaryOf(value);
    const ProblemsTab = await loadProblemsTab();
    renderTab(ProblemsTab, value);

    expect(tabByLabel('判断题')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(SINGLE.title)).toBeNull();

    await user.click(tabByLabel('单选题'));

    expect(tabByLabel('单选题')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(TRUE_FALSE_A.title)).toBeNull();
    expect(screen.queryByText(TRUE_FALSE_B.title)).toBeNull();
    expect(within(rowOf(SINGLE.title)).getByText('3', { exact: true })).toBeInTheDocument();
    expectSummary(summary);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('shows the empty paperSummary and the read-only empty paper', async () => {
    const value = payload('exam', EXAM_ID, 'exam', [], null);
    const summary = summaryOf(value);
    expect(summary).toBe(EMPTY_SUMMARY);

    const ProblemsTab = await loadProblemsTab();
    renderTab(ProblemsTab, value);

    expectEditLink(`/teach/exam/${EXAM_ID}/compose`);
    expectSummary(summary);
    expect(screen.getAllByText(EMPTY_SUMMARY).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('uses the homework compose path and that paperSummary', async () => {
    const programming = problem({
      docId: 31,
      pid: 'P3001',
      title: '循环右移',
      kind: 'programming',
      score: 20,
    });
    const value = payload('homework', HOMEWORK_ID, 'homework', [programming], null);
    const summary = summaryOf(value);
    expect(summary.startsWith('共 ')).toBe(true);
    expect(summary).toContain('满分');

    const ProblemsTab = await loadProblemsTab();
    renderTab(ProblemsTab, value);

    expectEditLink(`/teach/homework/${HOMEWORK_ID}/compose`);
    expectSummary(summary);
    expect(screen.getByText(programming.title)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the draw paperSummary for an exam with quotas', async () => {
    const value = payload('exam', EXAM_ID, 'exam', [TRUE_FALSE_A, TRUE_FALSE_B, SINGLE], {
      true_false: 1,
      single: 1,
    });
    const summary = summaryOf(value);
    expect(summary.startsWith('题库 ')).toBe(true);
    expect(summary).toContain('每人');

    const ProblemsTab = await loadProblemsTab();
    renderTab(ProblemsTab, value);

    expectEditLink(`/teach/exam/${EXAM_ID}/compose`);
    expectSummary(summary);
    expect(screen.getByText(/每人抽/)).toBeTruthy();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});
