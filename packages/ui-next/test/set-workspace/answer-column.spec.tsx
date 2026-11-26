// A static import fails collection while src/pages/set-workspace/answer-column.tsx is absent.
import type { ProblemKind } from '@hydrooj/common';
import { act, cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cellClass,
  sectionHref,
  type CellState,
  type DraftMap,
  type SetWorkspace,
  type WsDraft,
  type WsGroup,
  type WsItem,
} from '../../src/pages/set-workspace/model.ts';

const columnLoaders = import.meta.glob('../../src/pages/set-workspace/answer-column.tsx');

const COLUMN_SOURCE = 'src/pages/set-workspace/answer-column.tsx';
const TID = '64b8000000000000000000a1';
const CELL_SHAPE = ['h-8', 'rounded-sm', 'font-mono', 'text-xs'] as const;
const GRID_CLASS = ['grid', 'grid-cols-5', 'gap-2'] as const;
const CHIP_ROW_CLASS = ['overflow-x-auto', 'scrollbar-none'] as const;
const HOMEWORK_LEGEND = ['未作答', '已作答未提交', '已提交', '正确', '错误', '部分正确', '已标记'] as const;
const PAPER_LEGEND = ['未作答', '已保存', '正确', '错误', '部分正确', '已标记'] as const;

interface AnswerColumnProps {
  ws: SetWorkspace;
  currentKind: ProblemKind;
  currentPid: number | null;
  drafts: DraftMap;
}

interface AnswerColumnModule {
  AnswerColumn: ComponentType<AnswerColumnProps>;
  AnswerChips: ComponentType<AnswerColumnProps>;
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

function moduleLoader(loaders: object, source: string): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(loaders)) {
    if (!key.endsWith(source)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadModule(loaders: object, source: string): Promise<object> {
  const load = moduleLoader(loaders, source);
  expect(typeof load, `${source} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${source} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${source} must be a module`);
  return imported;
}

async function loadColumns(): Promise<AnswerColumnModule> {
  const imported = await loadModule(columnLoaders, COLUMN_SOURCE);
  return {
    AnswerColumn: asComponent<AnswerColumnProps>(readField(imported, 'AnswerColumn'), 'AnswerColumn'),
    AnswerChips: asComponent<AnswerColumnProps>(readField(imported, 'AnswerChips'), 'AnswerChips'),
  };
}

let loading: Promise<AnswerColumnModule> | undefined;

function columns(): Promise<AnswerColumnModule> {
  loading ??= loadColumns();
  return loading;
}

function emptyDrafts(): DraftMap {
  return new Map<number, WsDraft>();
}

function item(pid: number, label: string, state: CellState, kind: ProblemKind, score = 5): WsItem {
  return {
    pid,
    label,
    title: `题目 ${label}`,
    kind,
    score,
    state,
    submits: state === 'empty' ? 0 : 1,
    lastScore: state === 'correct' ? score : state === 'partial' ? Math.floor(score / 2) : null,
  };
}

function group(kind: ProblemKind, no: number | null, name: string, items: WsItem[], scoreEach: number | null = 5): WsGroup {
  return {
    kind,
    no,
    name,
    scoreEach,
    items,
  };
}

function urls(overview: string): SetWorkspace['urls'] {
  return {
    back: '/training',
    manage: null,
    overview,
    problem: null,
    submit: null,
    submitCode: null,
    recordDetail: `/record/__RID__?tid=${TID}`,
    records: `/record?tid=${TID}&uidOrName=62`,
    ranking: null,
    clarify: null,
    print: null,
    start: null,
    attend: null,
    draftList: null,
    draftUpsert: null,
    submitKind: null,
    lockKind: null,
    finalize: null,
    virtual: null,
    practice: null,
    teamProblem: null,
    pretest: null,
  };
}

function workspace(options: {
  kind: SetWorkspace['kind'];
  flavor: SetWorkspace['flavor'];
  numbering: SetWorkspace['numbering'];
  overview: string;
  groups: WsGroup[];
  locked?: SetWorkspace['locked'];
  paper?: SetWorkspace['paper'];
}): SetWorkspace {
  let problemCount = 0;
  for (const entry of options.groups) problemCount += entry.items.length;
  return {
    kind: options.kind,
    flavor: options.flavor,
    tid: TID,
    title: '第 4 周 · 栈与队列',
    description: '',
    mode: 'browser',
    phase: 'answering',
    locked: options.locked ?? null,
    numbering: options.numbering,
    window: {
      beginAt: '2026-10-18T08:00:00+08:00',
      endAt: '2026-10-18T18:00:00+08:00',
      dueAt: null,
      durationMinutes: null,
      startAt: null,
      personalEndAt: null,
      lockAt: null,
    },
    groups: options.groups,
    totals: {
      problemCount,
      maxScore: null,
      answered: 0,
      score: null,
      accepted: null,
      showScore: false,
    },
    verdictVisible: false,
    objectiveVerdictVisible: true,
    team: null,
    paper: options.paper ?? null,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '张三', studentId: '2024010203' },
    action: {
      canStart: false,
      canFinalize: false,
      canAttend: false,
      canUnrank: false,
      canSubmit: true,
      attended: true,
      canRetake: false,
    },
    urls: urls(options.overview),
  };
}

const SINGLE_ITEMS: WsItem[] = [
  item(201, '2-1', 'empty', 'single'),
  item(202, '2-2', 'draft', 'single'),
  item(203, '2-3', 'submitted', 'single'),
  item(204, '2-4', 'correct', 'single'),
  item(205, '2-5', 'wrong', 'single'),
];

const TRUE_FALSE_ITEMS: WsItem[] = [item(101, '1-1', 'empty', 'true_false'), item(102, '1-2', 'wrong', 'true_false')];

const PAPER: NonNullable<SetWorkspace['paper']> = {
  score: null,
  passed: null,
  judging: false,
  passScore: 60,
  attemptLimit: null,
  attemptsUsed: 0,
  canRetake: false,
  submitByKind: false,
  lockedKinds: [],
};

function homework(groups: WsGroup[], locked: SetWorkspace['locked'] = null): SetWorkspace {
  return workspace({
    kind: 'homework',
    flavor: 'homework',
    numbering: 'pta',
    overview: `/homework/${TID}`,
    groups,
    locked,
  });
}

function homeworkSingle(locked: SetWorkspace['locked'] = null): SetWorkspace {
  return homework([group('true_false', 1, '判断题', TRUE_FALSE_ITEMS), group('single', 2, '单选题', SINGLE_ITEMS)], locked);
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function expectTokens(element: Element, className: string): void {
  const actual = classTokens(element);
  for (const token of className.split(/\s+/)) {
    if (token.length === 0) continue;
    expect(actual, token).toContain(token);
  }
}

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function ownText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function exactNodes(container: HTMLElement, text: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const node of container.querySelectorAll('*')) {
    if (node instanceof HTMLElement && ownText(node) === text) found.push(node);
  }
  return found;
}

function footerText(total: number): string {
  return `当前 1 \u2013 ${total} 项，共 ${total} 项`;
}

function progressLabel(flavor: SetWorkspace['flavor']): string {
  if (flavor === 'acm') return '通过 / 题数';
  if (flavor === 'ioi' || flavor === 'oi') return '满分 / 题数';
  return '作答 / 题数';
}

function flagStorageKey(pid: number): string {
  return `ws-flag:${TID}:${pid}`;
}

function flag(pid: number): void {
  localStorage.setItem(flagStorageKey(pid), '1');
}

function changedDraft(pid: number): DraftMap {
  const drafts = new Map<number, WsDraft>();
  drafts.set(pid, { answers: { choice: 'A' }, submittedAnswers: { choice: 'B' } });
  return drafts;
}

function withFacts(source: WsItem, submits: number, lastScore: number | null): WsItem {
  return { ...source, submits, lastScore };
}

async function publishFlag(pid: number, value: string | null): Promise<void> {
  const key = flagStorageKey(pid);
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  await act(async () => {
    window.dispatchEvent(new CustomEvent('ws-storage', { detail: { key, value } }));
  });
}

function renderColumn(
  Column: ComponentType<AnswerColumnProps>,
  ws: SetWorkspace,
  currentKind: ProblemKind,
  currentPid: number | null,
  drafts: DraftMap = emptyDrafts(),
): HTMLElement {
  return render(<Column ws={ws} currentKind={currentKind} currentPid={currentPid} drafts={drafts} />).container;
}

function hashCells(container: HTMLElement): HTMLAnchorElement[] {
  const found: HTMLAnchorElement[] = [];
  for (const node of container.querySelectorAll('a')) {
    if (!(node instanceof HTMLAnchorElement)) continue;
    if ((node.getAttribute('href') ?? '').startsWith('#q-')) found.push(node);
  }
  return found;
}

function anchorWithHref(container: HTMLElement, href: string): HTMLAnchorElement | null {
  for (const node of container.querySelectorAll('a')) {
    if (node instanceof HTMLAnchorElement && node.getAttribute('href') === href) return node;
  }
  return null;
}

function requireAnchor(container: HTMLElement, href: string): HTMLAnchorElement {
  const cell = anchorWithHref(container, href);
  if (!(cell instanceof HTMLAnchorElement)) throw new TypeError(href);
  return cell;
}

function groupLink(container: HTMLElement, name: string): HTMLAnchorElement {
  for (const node of container.querySelectorAll('a')) {
    if (!(node instanceof HTMLAnchorElement)) continue;
    const text = textOf(node);
    if (text.includes(name) && text.includes(' / ')) return node;
  }
  throw new TypeError(`group ${name}`);
}

function expectQueryHref(container: HTMLElement, name: string, href: string): void {
  const actual = groupLink(container, name).getAttribute('href') ?? '';
  expect(actual, name).not.toContain('kind=');
  expect(actual, name).toBe(href);
}

function labeled(container: HTMLElement, label: string): HTMLElement {
  const found: HTMLElement[] = [];
  for (const node of container.querySelectorAll('[aria-label]')) {
    if (node instanceof HTMLElement && node.getAttribute('aria-label') === label) found.push(node);
  }
  if (found.length !== 1) throw new TypeError(`${label} count ${found.length}`);
  const element = found[0];
  if (!(element instanceof HTMLElement)) throw new TypeError(label);
  return element;
}

function ancestorWithTokens(element: Element, tokens: readonly string[]): HTMLElement {
  let current: Element | null = element.parentElement;
  while (current) {
    if (current instanceof HTMLElement) {
      const tokensOf = classTokens(current);
      const matched = tokens.every((token) => tokensOf.includes(token));
      if (matched) return current;
    }
    current = current.parentElement;
  }
  throw new TypeError(tokens.join(' '));
}

function legendControl(container: HTMLElement): HTMLElement {
  const labels = exactNodes(container, '图例');
  const label = labels[0];
  if (!(label instanceof HTMLElement)) throw new TypeError('图例');
  const host = label.closest('[data-slot="button"]');
  if (!(host instanceof HTMLElement)) throw new TypeError('图例 button');
  return host;
}

function expectNoNativeButton(container: HTMLElement): void {
  expect(container.querySelector('button')).toBeNull();
}

function expectCellShape(element: Element, state: CellState, flagged: boolean, current: boolean): void {
  expectTokens(element, CELL_SHAPE.join(' '));
  expectTokens(element, cellClass(state, flagged, current));
}

function expectLegendLabels(container: HTMLElement, labels: readonly string[], absent: readonly string[]): void {
  for (const label of labels) {
    expect(exactNodes(container, label).length, label).toBeGreaterThan(0);
  }
  for (const label of absent) {
    expect(exactNodes(container, label), label).toHaveLength(0);
  }
}

afterEach(() => {
  localStorage.clear();
});

describe('answer column', () => {
  it('renders five homework single-choice anchors with cell classes and a stored flag', async () => {
    flag(202);
    const { AnswerColumn } = await columns();
    const ws = homeworkSingle();
    const container = renderColumn(AnswerColumn, ws, 'single', 204);

    expect(textOf(container)).toContain('题目总览');
    expect(textOf(container)).toContain(progressLabel('homework'));
    expect(textOf(container)).not.toContain('通过 / 题数');
    expect(textOf(container)).not.toContain('满分 / 题数');

    const trueFalse = groupLink(container, '判断题');
    const single = groupLink(container, '单选题');
    expect(trueFalse).toHaveAttribute('href', sectionHref(ws, 'problems', { kind: 'true_false' }));
    expect(single).toHaveAttribute('href', sectionHref(ws, 'problems', { kind: 'single' }));
    expect(textOf(trueFalse)).toContain('1 / 2');
    expect(textOf(single)).toContain('4 / 5');
    expect(classTokens(single)).toContain('bg-surface-active');
    expect(classTokens(trueFalse)).not.toContain('bg-surface-active');

    const legend = legendControl(container);
    expect(legend).toHaveAttribute('data-variant', 'ghost');
    expect(legend).toHaveAttribute('data-size', 'sm');
    expectNoNativeButton(container);
    expect(exactNodes(container, '部分正确')).toHaveLength(0);
    expect(exactNodes(container, '已标记')).toHaveLength(0);

    const cells = hashCells(container);
    expect(cells.map((cell) => cell.getAttribute('href'))).toEqual(['#q-2-1', '#q-2-2', '#q-2-3', '#q-2-4', '#q-2-5']);
    const firstCell = cells[0];
    if (!(firstCell instanceof HTMLAnchorElement)) throw new TypeError('first cell');
    const grid = ancestorWithTokens(firstCell, GRID_CLASS);
    expect([...grid.querySelectorAll('a')]).toHaveLength(5);
    const states: CellState[] = ['empty', 'draft', 'submitted', 'correct', 'wrong'];
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const state = states[index];
      if (!(cell instanceof HTMLAnchorElement) || state === undefined) throw new TypeError(`cell ${index}`);
      expect(textOf(cell)).toBe(String(index + 1));
      expect(cell).toHaveAttribute('aria-label', `2-${index + 1}`);
      expectCellShape(cell, state, index === 1, index === 3);
      if (index === 1) expect(classTokens(cell)).toContain('after:bg-warning');
      else expect(classTokens(cell)).not.toContain('after:bg-warning');
    }
    expect(textOf(container)).toContain(footerText(5));
  });

  it('lists homework and paper legend words after toggling 图例', async () => {
    const { AnswerColumn } = await columns();
    const user = userEvent.setup();
    const homeworkView = renderColumn(AnswerColumn, homeworkSingle(), 'single', 204);
    expectNoNativeButton(homeworkView);
    await user.click(legendControl(homeworkView));
    expectNoNativeButton(homeworkView);
    expectLegendLabels(homeworkView, HOMEWORK_LEGEND, ['已保存']);

    cleanup();
    const paper = workspace({
      kind: 'paper',
      flavor: 'paper',
      numbering: 'pta',
      overview: `/paper/${TID}`,
      groups: [group('single', 2, '单选题', SINGLE_ITEMS)],
      paper: PAPER,
    });
    const paperView = renderColumn(AnswerColumn, paper, 'single', 204);
    expect(textOf(paperView)).toContain(progressLabel('paper'));
    expectNoNativeButton(paperView);
    await user.click(legendControl(paperView));
    expectNoNativeButton(paperView);
    expectLegendLabels(paperView, PAPER_LEGEND, ['已提交', '已作答未提交']);
  });

  it('renders locked cells as empty spans and never a native button', async () => {
    const { AnswerColumn } = await columns();
    const locked = homeworkSingle({ reason: 'not_started' });
    const objective = renderColumn(AnswerColumn, locked, 'single', 204);
    expectNoNativeButton(objective);
    expect(hashCells(objective)).toHaveLength(0);
    for (let index = 0; index < SINGLE_ITEMS.length; index += 1) {
      const source = SINGLE_ITEMS[index];
      if (!source) throw new TypeError(`single ${index}`);
      const cell = labeled(objective, source.label);
      expect(cell.tagName).toBe('SPAN');
      expectCellShape(cell, 'empty', false, source.pid === 204);
      expect(classTokens(cell)).not.toContain('bg-success-soft');
      expect(classTokens(cell)).not.toContain('bg-brand-soft');
      expect(classTokens(cell)).not.toContain('bg-danger-soft');
    }
    expect(textOf(groupLink(objective, '判断题'))).toContain('1 / 2');
    expect(textOf(groupLink(objective, '单选题'))).toContain('4 / 5');

    cleanup();
    const programming = homework(
      [group('programming', 7, '编程题', [item(701, '7-1', 'correct', 'programming'), item(702, '7-2', 'draft', 'programming')])],
      { reason: 'view_closed' },
    );
    const programView = renderColumn(AnswerColumn, programming, 'programming', 701);
    expectNoNativeButton(programView);
    for (const pid of [701, 702]) {
      const source = programming.groups[0]?.items.find((entry) => entry.pid === pid);
      if (!source) throw new TypeError(`pid ${pid}`);
      const cell = labeled(programView, source.label);
      expect(cell.tagName).toBe('SPAN');
      expectCellShape(cell, 'empty', false, pid === 701);
    }
    expectQueryHref(programView, '编程题', sectionHref(programming, 'problems', { q: 701 }));
    expect(anchorWithHref(programView, sectionHref(programming, 'problems', { q: 702 }))).toBeNull();
  });

  it('links one-per-page cells to the problem query', async () => {
    const { AnswerColumn } = await columns();
    const cases = [
      { kind: 'program_fill' as const, no: 5, name: '程序填空题', pid: 501, label: '5-1' },
      { kind: 'function' as const, no: 6, name: '函数题', pid: 601, label: '6-1' },
      { kind: 'programming' as const, no: 7, name: '编程题', pid: 701, label: '7-1' },
    ];
    for (const entry of cases) {
      cleanup();
      const problem = item(entry.pid, entry.label, 'submitted', entry.kind);
      const ws = homework([group(entry.kind, entry.no, entry.name, [problem])]);
      const container = renderColumn(AnswerColumn, ws, entry.kind, entry.pid);
      const href = sectionHref(ws, 'problems', { q: entry.pid });
      const cell = labeled(container, entry.label);
      expect(cell.tagName).toBe('A');
      expect(cell).toHaveAttribute('href', href);
      expect(textOf(cell)).toBe('1');
      expectCellShape(cell, 'submitted', false, true);
      expect(hashCells(container)).toHaveLength(0);
      const row = groupLink(container, entry.name);
      expectQueryHref(container, entry.name, sectionHref(ws, 'problems', { q: entry.pid }));
      expect(textOf(row)).toContain('1 / 1');
      expect(classTokens(row)).toContain('bg-surface-active');
      expect(textOf(container)).toContain(footerText(1));
    }
  });

  it('counts contest passes or full marks and letters the cells', async () => {
    const { AnswerColumn } = await columns();
    const user = userEvent.setup();
    const items = [
      item(1, 'A', 'correct', 'programming', 100),
      item(2, 'B', 'partial', 'programming', 100),
      item(3, 'C', 'empty', 'programming', 100),
    ];
    const flavors = ['acm', 'ioi', 'oi'] as const;
    for (const flavor of flavors) {
      cleanup();
      const ws = workspace({
        kind: 'contest',
        flavor,
        numbering: 'letter',
        overview: `/contest/${TID}`,
        groups: [group('programming', null, '题目', items, null)],
      });
      const container = renderColumn(AnswerColumn, ws, 'programming', 2);
      expect(textOf(container)).toContain(progressLabel(flavor));
      expect(textOf(container)).not.toContain('作答 / 题数');
      if (flavor === 'acm') expect(textOf(container)).not.toContain('满分 / 题数');
      else expect(textOf(container)).not.toContain('通过 / 题数');
      const row = groupLink(container, '题目');
      expect(textOf(row)).toContain('1 / 3');
      expect(classTokens(row)).toContain('bg-surface-active');
      expectQueryHref(container, '题目', sectionHref(ws, 'problems', { q: 2 }));
      const letters = ['A', 'B', 'C'] as const;
      const states: CellState[] = ['correct', 'partial', 'empty'];
      for (let index = 0; index < items.length; index += 1) {
        const source = items[index];
        const letter = letters[index];
        const state = states[index];
        if (!source || letter === undefined || state === undefined) throw new TypeError(`contest ${index}`);
        const cell = labeled(container, letter);
        expect(cell.tagName).toBe('A');
        expect(cell).toHaveAttribute('href', sectionHref(ws, 'problems', { q: source.pid }));
        expect(textOf(cell)).toBe(letter);
        expect(cell).toHaveAttribute('aria-label', letter);
        expectCellShape(cell, state, false, source.pid === 2);
      }
      expect(hashCells(container)).toHaveLength(0);
      expect(textOf(container)).toContain(footerText(3));
      await user.click(legendControl(container));
      expectLegendLabels(container, ['已保存'], ['已提交', '已作答未提交']);
    }
  });

  it('links a letter-group single cell by q and keeps a pta single on the hash', async () => {
    const { AnswerColumn } = await columns();
    const pta = renderColumn(AnswerColumn, homeworkSingle(), 'single', 201);
    const ptaCell = labeled(pta, '2-1');
    expect(ptaCell.tagName).toBe('A');
    expect(ptaCell).toHaveAttribute('href', '#q-2-1');

    cleanup();
    const contest = workspace({
      kind: 'contest',
      flavor: 'acm',
      numbering: 'letter',
      overview: `/contest/${TID}`,
      groups: [group('programming', null, '题目', [
        item(1, 'B', 'correct', 'programming', 100),
        item(5, 'A', 'empty', 'single', 100),
      ], null)],
    });
    const container = renderColumn(AnswerColumn, contest, 'programming', 5);
    const cell = labeled(container, 'A');
    expect(cell.tagName).toBe('A');
    expect(textOf(cell)).toBe('A');
    expect(cell).toHaveAttribute('href', sectionHref(contest, 'problems', { q: 5 }));
    expect(hashCells(container)).toHaveLength(0);
  });

  it('links a single group by kind and programming or contest rows by q', async () => {
    const { AnswerColumn } = await columns();
    const programs = [item(701, '7-1', 'submitted', 'programming'), item(702, '7-2', 'draft', 'programming')];
    const ws = homework([
      group('single', 2, '单选题', [item(201, '2-1', 'empty', 'single'), item(202, '2-2', 'draft', 'single')]),
      group('programming', 7, '编程题', programs),
    ]);
    const onProgram = renderColumn(AnswerColumn, ws, 'programming', 702);
    expect(groupLink(onProgram, '单选题')).toHaveAttribute('href', sectionHref(ws, 'problems', { kind: 'single' }));
    expectQueryHref(onProgram, '编程题', sectionHref(ws, 'problems', { q: 702 }));

    cleanup();
    const onSingle = renderColumn(AnswerColumn, ws, 'single', 201);
    expect(groupLink(onSingle, '单选题')).toHaveAttribute('href', sectionHref(ws, 'problems', { kind: 'single' }));
    expectQueryHref(onSingle, '编程题', sectionHref(ws, 'problems', { q: 701 }));

    cleanup();
    const letters = [item(801, 'A', 'correct', 'programming', 100), item(802, 'B', 'empty', 'programming', 100)];
    const contest = workspace({
      kind: 'contest',
      flavor: 'acm',
      numbering: 'letter',
      overview: `/contest/${TID}`,
      groups: [group('programming', null, '题目', letters, null)],
    });
    const inGroup = renderColumn(AnswerColumn, contest, 'programming', 802);
    expectQueryHref(inGroup, '题目', sectionHref(contest, 'problems', { q: 802 }));

    cleanup();
    const outside = renderColumn(AnswerColumn, contest, 'programming', null);
    expectQueryHref(outside, '题目', sectionHref(contest, 'problems', { q: 801 }));
  });

  it('paints a correct item as draft when its draft differs and keeps locked cells empty', async () => {
    const { AnswerColumn } = await columns();
    const blank = item(301, '2-1', 'empty', 'single');
    const changed = item(302, '2-2', 'correct', 'single');
    const groups = [group('single', 2, '单选题', [blank, changed])];
    const drafts = changedDraft(302);
    const open = renderColumn(AnswerColumn, homework(groups), 'single', null, drafts);
    const cell = requireAnchor(open, '#q-2-2');
    expectCellShape(cell, 'draft', false, false);
    expect(classTokens(cell)).not.toContain('bg-success-soft');
    expect(textOf(groupLink(open, '单选题'))).toContain('1 / 2');

    cleanup();
    const lockedView = renderColumn(AnswerColumn, homework(groups, { reason: 'not_started' }), 'single', 302, drafts);
    const lockedCell = labeled(lockedView, '2-2');
    expect(lockedCell.tagName).toBe('SPAN');
    expectCellShape(lockedCell, 'empty', false, true);
    expect(classTokens(lockedCell)).not.toContain('bg-brand-soft');
    expect(classTokens(lockedCell)).not.toContain('bg-success-soft');
  });

  it('restores a matching full-score draft to correct and clears an empty answer', async () => {
    const { AnswerColumn } = await columns();
    const scored = withFacts(item(401, '2-1', 'draft', 'single', 5), 2, 5);
    const cleared = withFacts(item(402, '2-2', 'draft', 'single', 5), 0, null);
    const drafts = new Map<number, WsDraft>([
      [401, { answers: { choice: 'A' }, submittedAnswers: { choice: 'A' } }],
      [402, { answers: null, submittedAnswers: null }],
    ]);
    const open = renderColumn(AnswerColumn, homework([group('single', 2, '单选题', [scored, cleared])]), 'single', null, drafts);
    const scoredCell = requireAnchor(open, '#q-2-1');
    const clearedCell = requireAnchor(open, '#q-2-2');
    expectCellShape(scoredCell, 'correct', false, false);
    expect(classTokens(scoredCell)).not.toContain('bg-brand-soft');
    expectCellShape(clearedCell, 'empty', false, false);
    expect(textOf(groupLink(open, '单选题'))).toContain('1 / 2');

    cleanup();
    const wiped = withFacts(item(501, '2-1', 'correct', 'single', 5), 1, 5);
    const paper = workspace({
      kind: 'paper',
      flavor: 'paper',
      numbering: 'pta',
      overview: `/paper/${TID}`,
      groups: [group('single', 2, '单选题', [wiped])],
      paper: PAPER,
    });
    const paperView = renderColumn(
      AnswerColumn,
      paper,
      'single',
      null,
      new Map<number, WsDraft>([[501, { answers: null, submittedAnswers: { choice: 'A' } }]]),
    );
    const wipedCell = requireAnchor(paperView, '#q-2-1');
    expectCellShape(wipedCell, 'empty', false, false);
    expect(classTokens(wipedCell)).not.toContain('bg-success-soft');
    expect(textOf(groupLink(paperView, '单选题'))).toContain('0 / 1');
  });

  async function expectLiveFlag(Column: ComponentType<AnswerColumnProps>): Promise<void> {
    const ws = homework([group('single', 2, '单选题', [item(202, '2-1', 'draft', 'single')])]);
    const container = renderColumn(Column, ws, 'single', null);
    const cell = () => requireAnchor(container, '#q-2-1');
    expect(classTokens(cell())).not.toContain('after:bg-warning');
    await publishFlag(202, '1');
    expect(classTokens(cell())).toContain('after:bg-warning');
    await publishFlag(202, null);
    expect(classTokens(cell())).not.toContain('after:bg-warning');
  }

  it('shows and clears a column flag dot after ws-storage', async () => {
    const { AnswerColumn } = await columns();
    await expectLiveFlag(AnswerColumn);
  });

  it('shows and clears a chip flag dot after ws-storage', async () => {
    const { AnswerChips } = await columns();
    await expectLiveFlag(AnswerChips);
  });

  it('scrolls the current group as chips with the same cell classes', async () => {
    flag(202);
    const { AnswerChips } = await columns();
    const ws = homeworkSingle();
    const container = renderColumn(AnswerChips, ws, 'single', 204);
    const cells = hashCells(container);
    expect(cells.map((cell) => cell.getAttribute('href'))).toEqual(['#q-2-1', '#q-2-2', '#q-2-3', '#q-2-4', '#q-2-5']);
    const firstChip = cells[0];
    if (!(firstChip instanceof HTMLAnchorElement)) throw new TypeError('first chip');
    const row = ancestorWithTokens(firstChip, CHIP_ROW_CLASS);
    expect(classTokens(row)).toContain('min-w-0');
    expect([...row.querySelectorAll('a')].filter((node) => (node.getAttribute('href') ?? '').startsWith('#q-'))).toHaveLength(5);
    expect(row.querySelector('[aria-label="1-1"]')).toBeNull();
    const states: CellState[] = ['empty', 'draft', 'submitted', 'correct', 'wrong'];
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const state = states[index];
      if (!(cell instanceof HTMLAnchorElement) || state === undefined) throw new TypeError(`chip ${index}`);
      expect(textOf(cell)).toBe(String(index + 1));
      expect(cell).toHaveAttribute('aria-label', `2-${index + 1}`);
      expectCellShape(cell, state, index === 1, index === 3);
      if (index === 1) expect(classTokens(cell)).toContain('after:bg-warning');
      else expect(classTokens(cell)).not.toContain('after:bg-warning');
    }
    expectNoNativeButton(container);
  });

  it('renders locked chips as empty spans without anchors', async () => {
    const { AnswerChips } = await columns();
    const container = renderColumn(AnswerChips, homeworkSingle({ reason: 'client_only' }), 'single', 201);
    expect(container.querySelector('a')).toBeNull();
    expectNoNativeButton(container);
    for (let index = 0; index < SINGLE_ITEMS.length; index += 1) {
      const source = SINGLE_ITEMS[index];
      if (!source) throw new TypeError(`chip ${index}`);
      const cell = labeled(container, source.label);
      expect(cell.tagName).toBe('SPAN');
      expectCellShape(cell, 'empty', false, source.pid === 201);
    }
    ancestorWithTokens(labeled(container, '2-1'), CHIP_ROW_CLASS);
  });
});
