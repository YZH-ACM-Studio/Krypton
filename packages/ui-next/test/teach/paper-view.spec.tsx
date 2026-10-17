// A static import fails collection while the paper view modules are absent.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ProblemKind } from '@hydrooj/common';
import { TEACH_KIND_LABEL } from '../../src/pages/teach/model.ts';

const kindTabLoaders = import.meta.glob('../../src/components/teach/kind-tabs.tsx');
const paperViewLoaders = import.meta.glob('../../src/pages/teach/paper-view.tsx');

const KIND_TABS_SOURCE = 'src/components/teach/kind-tabs.tsx';
const PAPER_VIEW_SOURCE = 'src/pages/teach/paper-view.tsx';
const DOT = '\u00B7';
const EMPTY_TITLE = '还没有题目';
const EMPTY_DESCRIPTION = '点「编辑题目」从题库里加题。';
const DRAW_MISMATCH = '抽题时本组必须同分';
const COUNT_TOKENS = ['inline-block', 'w-5', 'text-right', 'text-xs', 'tabular', 'text-fg-subtle'] as const;
const NUMBER_TOKENS = ['w-8', 'shrink-0', 'text-xs', 'tabular', 'text-fg-subtle'] as const;
const PID_TOKENS = ['shrink-0', 'font-mono', 'text-xs', 'text-fg-subtle'] as const;
const TITLE_TOKENS = ['min-w-0', 'truncate', 'text-sm'] as const;
const SCORE_TOKENS = ['shrink-0', 'tabular', 'text-sm', 'text-fg-muted'] as const;
const HEADER_TOKENS = ['flex', 'flex-wrap', 'items-center', 'gap-x-4', 'gap-y-1', 'border-b', 'border-line-subtle', 'px-4', 'py-3', 'text-sm'] as const;
const COMPACT_TOKENS = ['gap-2', 'px-4', 'py-8'] as const;
const HINT_TOKENS = ['text-xs', 'text-fg-subtle'] as const;
const SMALL_CONTROL = 'h-[calc(var(--control-sm)-4px)]';

interface PaperItem {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  score: number | null;
  hidden: boolean;
  stageId: number | null;
}

interface PaperStage {
  id: number;
  title: string;
  requireIds: number[];
}

interface PaperState {
  type: 'practice' | 'homework' | 'exam' | 'acm' | 'oi';
  rule: string;
  items: PaperItem[];
  stages: PaperStage[] | null;
  draw: boolean;
  quotas: Partial<Record<ProblemKind, number>>;
}

interface KindTabsProps {
  kinds: readonly ProblemKind[];
  counts: Partial<Record<ProblemKind, number>>;
  value: ProblemKind;
  onValueChange: (kind: ProblemKind) => void;
  'aria-label'?: string;
}

interface PaperViewProps {
  state: PaperState;
  activeKind: ProblemKind | null;
  onActiveKindChange: (kind: ProblemKind) => void;
}

interface PaperViews {
  KindTabs: ComponentType<KindTabsProps>;
  PaperView: ComponentType<PaperViewProps>;
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

async function loadViews(): Promise<PaperViews> {
  const tabs = await loadModule(kindTabLoaders, KIND_TABS_SOURCE);
  const view = await loadModule(paperViewLoaders, PAPER_VIEW_SOURCE);
  return {
    KindTabs: asComponent<KindTabsProps>(readField(tabs, 'KindTabs'), 'KindTabs'),
    PaperView: asComponent<PaperViewProps>(readField(view, 'PaperView'), 'PaperView'),
  };
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function hasAll(element: Element, tokens: readonly string[]): boolean {
  const actual = classTokens(element);
  return tokens.every((token) => actual.includes(token));
}

function expectStyled(node: HTMLElement, tokens: readonly string[]) {
  const host = hasAll(node, tokens) ? node : node.parentElement;
  if (!host) throw new TypeError(node.textContent ?? 'styled node');
  const actual = classTokens(host);
  for (const token of tokens) {
    expect(actual, actual.join(' ')).toContain(token);
  }
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function panels(): HTMLElement[] {
  return [...document.querySelectorAll('[data-slot="panel"]')].filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function expectFlush(panel: HTMLElement) {
  const body = panel.firstElementChild;
  if (!(body instanceof HTMLElement)) throw new TypeError('panel body');
  expect(classTokens(body)).not.toContain('p-4');
}

function tabTexts(): string[] {
  return screen.getAllByRole('tab').map((tab) => (tab.textContent ?? '').replace(/\s+/g, ''));
}

function tabByLabel(label: string): HTMLElement {
  const found = screen.getAllByRole('tab').find((tab) => (tab.textContent ?? '').includes(label));
  if (!found) throw new TypeError(`tab ${label}`);
  return found;
}

function countSlot(tab: HTMLElement): HTMLElement {
  const slot = [...tab.querySelectorAll('span')].find((node) => hasAll(node, COUNT_TOKENS));
  if (!(slot instanceof HTMLElement)) throw new TypeError(`count slot ${tab.textContent ?? ''}`);
  return slot;
}

function expectKindTabShell(label = '题型') {
  const lists = screen.getAllByRole('tablist');
  expect(lists).toHaveLength(1);
  const list = lists[0];
  if (!list) throw new TypeError('tablist');
  expect(list).toHaveAttribute('aria-label', label);
  const shell = list.parentElement;
  if (!shell) throw new TypeError('kind tab shell');
  expect(hasAll(shell, ['overflow-x-auto', 'scrollbar-none'])).toBe(true);
  for (const tab of screen.getAllByRole('tab')) {
    expect(classTokens(tab)).toContain(SMALL_CONTROL);
    const slot = countSlot(tab);
    expect(classTokens(slot)).not.toContain('text-2xs');
    expect([...tab.querySelectorAll('span')].filter((node) => classTokens(node).includes('text-2xs'))).toHaveLength(0);
  }
}

function ancestorWithTokens(element: Element, tokens: readonly string[]): HTMLElement | null {
  let current: Element | null = element;
  while (current) {
    if (hasAll(current, tokens)) return current instanceof HTMLElement ? current : null;
    current = current.parentElement;
  }
  return null;
}

function headerOf(panel: HTMLElement): HTMLElement {
  const header = [...panel.querySelectorAll('*')].find((node) => hasAll(node, HEADER_TOKENS));
  if (!(header instanceof HTMLElement)) throw new TypeError('group header');
  return header;
}

function rowByTitle(title: string): HTMLElement {
  const titleNode = screen.getByText(title, { exact: true });
  let current: HTMLElement | null = titleNode.parentElement;
  while (current) {
    const parent = current.parentElement;
    if (parent && hasAll(parent, ['divide-y', 'divide-line-subtle'])) return current;
    current = parent;
  }
  throw new TypeError(`row for ${title}`);
}

function expectGroupedRow(title: string, pid: string, numberLabel: string, score: string) {
  const row = rowByTitle(title);
  expectStyled(within(row).getByText(numberLabel, { exact: true }), NUMBER_TOKENS);
  expectStyled(within(row).getByText(pid, { exact: true }), PID_TOKENS);
  expectStyled(within(row).getByText(title, { exact: true }), TITLE_TOKENS);
  expectStyled(within(row).getByText(score, { exact: true }), SCORE_TOKENS);
}

function stageHeader(index: number, title: string): string {
  return `阶段 ${index} ${DOT} ${title}`;
}

function ignoreKind() {}

function leafIndex(root: ParentNode, text: string): number {
  return [...root.querySelectorAll('*')].findIndex((node) => (
    node instanceof HTMLElement
    && node.children.length === 0
    && (node.textContent ?? '').trim() === text
  ));
}

function expectLeafOrder(root: ParentNode, labels: readonly string[]) {
  let previous = -1;
  for (const label of labels) {
    const index = leafIndex(root, label);
    expect(index, label).toBeGreaterThan(previous);
    previous = index;
  }
}

function drawLine(count: number, quota: number): string {
  return `${count} 道 ${DOT} 每人抽 ${quota} 道`;
}

function item(fields: {
  docId: number;
  kind: ProblemKind;
  title: string;
  score?: number | null;
  stageId?: number | null;
  hidden?: boolean;
  pid?: string;
}): PaperItem {
  return {
    docId: fields.docId,
    pid: fields.pid ?? `P${fields.docId}`,
    title: fields.title,
    kind: fields.kind,
    score: fields.score === undefined ? null : fields.score,
    hidden: fields.hidden ?? false,
    stageId: fields.stageId ?? null,
  };
}

function paper(fields: {
  type: PaperState['type'];
  rule?: string;
  items: PaperItem[];
  stages?: PaperStage[] | null;
  draw?: boolean;
  quotas?: Partial<Record<ProblemKind, number>>;
}): PaperState {
  return {
    type: fields.type,
    rule: fields.rule ?? fields.type,
    items: fields.items,
    stages: fields.stages === undefined ? null : fields.stages,
    draw: fields.draw ?? false,
    quotas: fields.quotas ?? {},
  };
}

function PaperHarness({
  View,
  state,
  initialKind,
  onActiveKindChange,
}: {
  View: ComponentType<PaperViewProps>;
  state: PaperState;
  initialKind: ProblemKind | null;
  onActiveKindChange?: (kind: ProblemKind) => void;
}) {
  const [kind, setKind] = useState<ProblemKind | null>(initialKind);
  return (
    <View
      state={state}
      activeKind={kind}
      onActiveKindChange={(next) => {
        onActiveKindChange?.(next);
        setKind(next);
      }}
    />
  );
}

function KindDriver({
  View,
  state,
  onActiveKindChange,
}: {
  View: ComponentType<PaperViewProps>;
  state: PaperState;
  onActiveKindChange: (kind: ProblemKind) => void;
}) {
  const [kind, setKind] = useState<ProblemKind | null>(null);
  return (
    <>
      <button type="button" onClick={() => setKind('programming')}>pick-programming</button>
      <button type="button" onClick={() => setKind('multi')}>pick-multi</button>
      <View
        state={state}
        activeKind={kind}
        onActiveKindChange={(next) => {
          onActiveKindChange(next);
          setKind(next);
        }}
      />
    </>
  );
}

function examPaper(): PaperState {
  const singles = ['单选甲', '单选乙', '单选丙', '单选丁', '单选戊'];
  return paper({
    type: 'exam',
    items: [
      item({
        docId: 1, kind: 'true_false', title: '判断甲', score: 2, hidden: true, pid: 'TF1',
      }),
      item({
        docId: 2, kind: 'true_false', title: '判断乙', score: 2, pid: 'TF2',
      }),
      item({
        docId: 3, kind: 'true_false', title: '判断丙', score: 2, pid: 'TF3',
      }),
      ...singles.map((title, index) => item({
        docId: index + 4,
        kind: 'single',
        title,
        score: 2,
        pid: `SG${index + 1}`,
      })),
      item({
        docId: 9, kind: 'programming', title: '编程甲', score: 20, pid: 'PG9',
      }),
      item({
        docId: 10, kind: 'programming', title: '编程乙', score: 20, pid: 'PG10',
      }),
    ],
  });
}

describe('teach kind tabs', () => {
  it('reserves a two-digit tabular count and scrolls the given kind order', async () => {
    const { KindTabs } = await loadViews();
    render(
      <KindTabs
        kinds={['programming', 'true_false', 'single']}
        counts={{ programming: 2, true_false: 3, single: 12 }}
        value="single"
        onValueChange={ignoreKind}
      />,
    );

    expect(tabTexts()).toEqual([
      `${TEACH_KIND_LABEL.programming}2`,
      `${TEACH_KIND_LABEL.true_false}3`,
      `${TEACH_KIND_LABEL.single}12`,
    ]);
    expectKindTabShell();
    expect(tabByLabel(TEACH_KIND_LABEL.single)).toHaveAttribute('aria-selected', 'true');
    expect(countSlot(tabByLabel(TEACH_KIND_LABEL.single)).textContent).toBe('12');
    expect(screen.queryByRole('tab', { name: /多选题/ })).toBeNull();
  });

  it('uses a caller label and reports the kind that was chosen', async () => {
    const { KindTabs } = await loadViews();
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <KindTabs
        kinds={['true_false', 'programming']}
        counts={{ true_false: 1, programming: 4 }}
        value="true_false"
        onValueChange={onValueChange}
        aria-label="当前题型"
      />,
    );

    expectKindTabShell('当前题型');
    await user.click(tabByLabel(TEACH_KIND_LABEL.programming));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('programming');
  });

  it('shows zero when a count is missing or not a finite number', async () => {
    const { KindTabs } = await loadViews();
    render(
      <KindTabs
        kinds={['true_false', 'programming']}
        counts={{ true_false: Number.NaN }}
        value="true_false"
        onValueChange={ignoreKind}
      />,
    );

    expect(countSlot(tabByLabel(TEACH_KIND_LABEL.true_false)).textContent).toBe('0');
    expect(countSlot(tabByLabel(TEACH_KIND_LABEL.programming)).textContent).toBe('0');
    expect(tabTexts()).toEqual([
      `${TEACH_KIND_LABEL.true_false}0`,
      `${TEACH_KIND_LABEL.programming}0`,
    ]);
  });
});

describe('teach paper view', () => {
  it('shows three occupied exam tabs and continues numbering on the programming tab', async () => {
    const { PaperView } = await loadViews();
    const onActiveKindChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PaperHarness
        View={PaperView}
        state={examPaper()}
        initialKind="true_false"
        onActiveKindChange={onActiveKindChange}
      />,
    );

    expect(tabTexts()).toEqual([
      `${TEACH_KIND_LABEL.true_false}3`,
      `${TEACH_KIND_LABEL.single}5`,
      `${TEACH_KIND_LABEL.programming}2`,
    ]);
    expectKindTabShell();
    expect(onActiveKindChange).not.toHaveBeenCalled();
    expect(panels()).toHaveLength(1);
    const firstPanel = panels()[0];
    if (!firstPanel) throw new TypeError('exam panel');
    expectFlush(firstPanel);
    const header = headerOf(firstPanel);
    expectStyled(within(header).getByText(TEACH_KIND_LABEL.true_false, { exact: true }), ['font-medium']);
    expect(header.classList.contains('tabular') || header.querySelector('.tabular')).toBeTruthy();
    const firstText = normalizedText(firstPanel);
    expect(firstText).toContain('3 道');
    expect(firstText).toContain('每题 2 分');
    expect(firstText).toContain('小计 6 分');
    expect(firstText).not.toContain('每人抽');
    expect(firstText).not.toContain(DRAW_MISMATCH);
    expectGroupedRow('判断甲', 'TF1', '1', '2 分');
    expect(within(firstPanel).getByText('判断乙')).toBeTruthy();
    expect(within(firstPanel).getByText('判断丙')).toBeTruthy();
    expect(screen.queryByText('编程甲')).toBeNull();
    expect(screen.queryByText('草稿')).toBeNull();

    await user.click(tabByLabel(TEACH_KIND_LABEL.programming));

    expect(onActiveKindChange).toHaveBeenCalledTimes(1);
    expect(onActiveKindChange).toHaveBeenCalledWith('programming');
    expect(tabByLabel(TEACH_KIND_LABEL.programming)).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('判断甲')).toBeNull();
    const programmingPanel = panels()[0];
    if (!programmingPanel) throw new TypeError('programming panel');
    const programmingText = normalizedText(programmingPanel);
    expect(programmingText).toContain('2 道');
    expect(programmingText).toContain('每题 20 分');
    expect(programmingText).toContain('小计 40 分');
    expectGroupedRow('编程甲', 'PG9', '9', '20 分');
    expectGroupedRow('编程乙', 'PG10', '10', '20 分');
  });

  it('letters an acm paper from A to D without a score column', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'acm',
          items: [
            item({
              docId: 1, kind: 'program_fill', title: '填空甲', pid: 'C101',
            }),
            item({
              docId: 2, kind: 'function', title: '函数甲', pid: 'C102',
            }),
            item({
              docId: 3, kind: 'programming', title: '编程甲', pid: 'C103',
            }),
            item({
              docId: 4, kind: 'programming', title: '编程乙', pid: 'C104',
            }),
          ],
        })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    expect(panels()).toHaveLength(1);
    const panel = panels()[0];
    if (!panel) throw new TypeError('acm panel');
    expectFlush(panel);
    expectLeafOrder(panel, ['A', 'B', 'C', 'D']);
    const text = normalizedText(panel);
    expect(text).not.toContain('分');
    expect(text.indexOf('填空甲')).toBeLessThan(text.indexOf(TEACH_KIND_LABEL.program_fill));
    expect(text.indexOf('函数甲')).toBeLessThan(text.indexOf(TEACH_KIND_LABEL.function));
    expect(text).not.toContain(TEACH_KIND_LABEL.programming);
    const badges = [...panel.querySelectorAll('[data-slot="badge"]')];
    expect(badges.map((badge) => badge.textContent)).toEqual([
      TEACH_KIND_LABEL.program_fill,
      TEACH_KIND_LABEL.function,
    ]);
    for (const badge of badges) {
      expect(badge.getAttribute('data-variant')).toBe('outline');
      expect(classTokens(badge)).toEqual(expect.arrayContaining(['h-4.5', 'text-2xs']));
    }
  });

  it('shows an oi score column and a kind badge only after a non-programming title', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'oi',
          items: [
            item({
              docId: 1, kind: 'function', title: '函数甲', score: 10, pid: 'O101',
            }),
            item({
              docId: 2, kind: 'programming', title: '编程甲', score: 20, pid: 'O102',
            }),
          ],
        })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    const panel = panels()[0];
    if (!panel) throw new TypeError('oi panel');
    expectLeafOrder(panel, ['A', 'B']);
    const text = normalizedText(panel);
    expect(text).toContain('10 分');
    expect(text).toContain('20 分');
    expect(text.indexOf('函数甲')).toBeLessThan(text.indexOf(TEACH_KIND_LABEL.function));
    expect(text).not.toContain(TEACH_KIND_LABEL.programming);
    const badge = panel.querySelector('[data-slot="badge"]');
    if (!(badge instanceof HTMLElement)) throw new TypeError('oi kind badge');
    expect(badge.textContent).toBe(TEACH_KIND_LABEL.function);
    expect(badge.getAttribute('data-variant')).toBe('outline');
    expect(classTokens(badge)).toEqual(expect.arrayContaining(['h-4.5', 'text-2xs']));
  });

  it('splits two practice stages into panels and names the prerequisite', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'practice',
          items: [
            item({
              docId: 1, kind: 'programming', title: '顺序查找', stageId: 1, pid: 'R1',
            }),
            item({
              docId: 2, kind: 'programming', title: '二分查找', stageId: 1, pid: 'R2',
            }),
            item({
              docId: 3, kind: 'single', title: '链表选择', stageId: 2, pid: 'R3',
            }),
          ],
          stages: [
            { id: 1, title: '顺序表', requireIds: [] },
            { id: 2, title: '链表', requireIds: [1] },
          ],
        })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    expect(panels()).toHaveLength(2);
    const [first, second] = panels();
    if (!first || !second) throw new TypeError('stage panels');
    expectFlush(first);
    expectFlush(second);
    expect(screen.getByText(stageHeader(1, '顺序表'))).toBeTruthy();
    expect(screen.getByText(stageHeader(2, '链表'))).toBeTruthy();
    expectStyled(screen.getByText('无先修', { exact: true }), HINT_TOKENS);
    expectStyled(screen.getByText('需先完成「顺序表」', { exact: true }), HINT_TOKENS);
    expect(within(first).getByText('2', { exact: true })).toBeTruthy();
    expect(normalizedText(first)).toContain('顺序查找');
    expect(normalizedText(first)).toContain('二分查找');
    expect(within(second).getByText('3', { exact: true })).toBeTruthy();
    expect(normalizedText(second)).toContain('链表选择');
    expect(normalizedText(first)).not.toContain('链表选择');
  });

  it('lays one practice stage out like a flat list numbered from 1', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'practice',
          items: [
            item({
              docId: 1, kind: 'single', title: '单选甲', stageId: 1, pid: 'S1',
            }),
            item({
              docId: 2, kind: 'programming', title: '编程甲', stageId: 1, pid: 'S2',
            }),
          ],
          stages: [{ id: 1, title: '顺序表', requireIds: [] }],
        })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    expect(panels()).toHaveLength(1);
    const panel = panels()[0];
    if (!panel) throw new TypeError('practice panel');
    expectFlush(panel);
    expect(within(panel).getByText('1', { exact: true })).toBeTruthy();
    expect(within(panel).getByText('2', { exact: true })).toBeTruthy();
    expect(within(panel).queryByText('A', { exact: true })).toBeNull();
    expect(within(panel).queryByText('B', { exact: true })).toBeNull();
    const text = normalizedText(panel);
    expect(text).not.toContain('阶段');
    expect(text).not.toContain('顺序表');
    expect(text).not.toContain('无先修');
    expect(text.indexOf('单选甲')).toBeLessThan(text.indexOf(TEACH_KIND_LABEL.single));
    expect(text).not.toContain(TEACH_KIND_LABEL.programming);
    const badge = panel.querySelector('[data-slot="badge"]');
    if (!(badge instanceof HTMLElement)) throw new TypeError('practice kind badge');
    expect(badge.textContent).toBe(TEACH_KIND_LABEL.single);
    expect(badge.getAttribute('data-variant')).toBe('outline');
  });

  it('warns only on the drawn group whose scores differ', async () => {
    const { PaperView } = await loadViews();
    const user = userEvent.setup();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'exam',
          draw: true,
          quotas: { true_false: 2, programming: 1 },
          items: [
            item({
              docId: 1, kind: 'true_false', title: '判断甲', score: 2, pid: 'TF1',
            }),
            item({
              docId: 2, kind: 'true_false', title: '判断乙', score: 4, pid: 'TF2',
            }),
            item({
              docId: 3, kind: 'programming', title: '编程甲', score: 20, pid: 'PG3',
            }),
            item({
              docId: 4, kind: 'programming', title: '编程乙', score: 20, pid: 'PG4',
            }),
          ],
        })}
        initialKind="true_false"
        onActiveKindChange={ignoreKind}
      />,
    );

    const mixed = panels()[0];
    if (!mixed) throw new TypeError('mixed panel');
    const mixedText = normalizedText(mixed);
    expect(mixedText).toContain(drawLine(2, 2));
    expect(mixedText).toContain('每题 不同');
    expect(mixedText).toContain('小计 6 分');
    const badge = screen.getByText(DRAW_MISMATCH);
    expect(badge.getAttribute('data-slot')).toBe('badge');
    expect(badge.getAttribute('data-tone')).toBe('warning');
    expect(classTokens(badge)).toEqual(expect.arrayContaining(['h-4.5', 'text-2xs']));

    await user.click(tabByLabel(TEACH_KIND_LABEL.programming));

    const uniform = panels()[0];
    if (!uniform) throw new TypeError('uniform panel');
    const uniformText = normalizedText(uniform);
    expect(uniformText).toContain(drawLine(2, 1));
    expect(uniformText).toContain('每题 20 分');
    expect(uniformText).toContain('小计 20 分');
    expect(uniformText).not.toContain('每题 不同');
    expect(screen.queryByText(DRAW_MISMATCH)).toBeNull();
    expect(within(uniform).getByText('3', { exact: true })).toBeTruthy();
    expect(within(uniform).getByText('4', { exact: true })).toBeTruthy();
  });

  it('shows different homework scores without a draw line', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'homework',
          draw: false,
          quotas: { single: 1 },
          items: [
            item({
              docId: 1, kind: 'single', title: '单选甲', score: 2, pid: 'H1',
            }),
            item({
              docId: 2, kind: 'single', title: '单选乙', score: 5, pid: 'H2',
            }),
          ],
        })}
        initialKind="single"
        onActiveKindChange={ignoreKind}
      />,
    );

    const panel = panels()[0];
    if (!panel) throw new TypeError('homework panel');
    const text = normalizedText(panel);
    expect(text).toContain('2 道');
    expect(text).toContain('每题 不同');
    expect(text).toContain('小计 7 分');
    expect(text).not.toContain('每人抽');
    expect(screen.queryByText(DRAW_MISMATCH)).toBeNull();
    expect(tabTexts()).toEqual([`${TEACH_KIND_LABEL.single}2`]);
  });

  it('shows the first occupied kind and notifies once when the active kind is absent', async () => {
    const { PaperView } = await loadViews();
    const onActiveKindChange = vi.fn();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'exam',
          items: [
            item({
              docId: 1, kind: 'true_false', title: '判断甲', score: 2, pid: 'TF1',
            }),
            item({
              docId: 2, kind: 'programming', title: '编程甲', score: 20, pid: 'PG2',
            }),
          ],
        })}
        initialKind={null}
        onActiveKindChange={onActiveKindChange}
      />,
    );

    expect(onActiveKindChange).toHaveBeenCalledTimes(1);
    expect(onActiveKindChange).toHaveBeenCalledWith('true_false');
    expect(tabByLabel(TEACH_KIND_LABEL.true_false)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('判断甲')).toBeTruthy();
    expect(screen.queryByText('编程甲')).toBeNull();
    expect(tabTexts()).toEqual([
      `${TEACH_KIND_LABEL.true_false}1`,
      `${TEACH_KIND_LABEL.programming}1`,
    ]);
  });

  it('shows the empty state and no draft badge when the paper has no problems', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({ type: 'exam', items: [] })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    const title = screen.getByText(EMPTY_TITLE, { exact: true });
    expect(ancestorWithTokens(title, COMPACT_TOKENS)).toBeTruthy();
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeTruthy();
    expect(screen.queryByText('草稿')).toBeNull();
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    expect(panels()).toHaveLength(0);
  });

  it('shows the first occupied kind when the active kind has no problems', async () => {
    const { PaperView } = await loadViews();
    const onActiveKindChange = vi.fn();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'exam',
          items: [
            item({
              docId: 1, kind: 'true_false', title: '判断甲', score: 2, pid: 'TF1',
            }),
            item({
              docId: 2, kind: 'programming', title: '编程甲', score: 20, pid: 'PG2',
            }),
          ],
        })}
        initialKind="multi"
        onActiveKindChange={onActiveKindChange}
      />,
    );

    expect(onActiveKindChange).toHaveBeenCalledTimes(1);
    expect(onActiveKindChange).toHaveBeenCalledWith('true_false');
    expect(tabTexts()).toEqual([
      `${TEACH_KIND_LABEL.true_false}1`,
      `${TEACH_KIND_LABEL.programming}1`,
    ]);
    expect(tabByLabel(TEACH_KIND_LABEL.true_false)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('判断甲')).toBeTruthy();
    expect(screen.queryByText('编程甲')).toBeNull();
    expect(screen.queryByText(TEACH_KIND_LABEL.multi)).toBeNull();
  });

  it('reports the fallback again after the parent leaves the occupied kinds', async () => {
    const { PaperView } = await loadViews();
    const onActiveKindChange = vi.fn();
    const user = userEvent.setup();
    render(
      <KindDriver
        View={PaperView}
        state={paper({
          type: 'exam',
          items: [
            item({
              docId: 1, kind: 'true_false', title: '判断甲', score: 2, pid: 'TF1',
            }),
            item({
              docId: 2, kind: 'programming', title: '编程甲', score: 20, pid: 'PG2',
            }),
          ],
        })}
        onActiveKindChange={onActiveKindChange}
      />,
    );

    expect(onActiveKindChange).toHaveBeenCalledTimes(1);
    expect(onActiveKindChange).toHaveBeenLastCalledWith('true_false');

    await user.click(screen.getByRole('button', { name: 'pick-programming' }));

    expect(onActiveKindChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText('编程甲')).toBeTruthy();
    expect(screen.queryByText('判断甲')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'pick-multi' }));

    expect(onActiveKindChange).toHaveBeenCalledTimes(2);
    expect(onActiveKindChange).toHaveBeenLastCalledWith('true_false');
    expect(tabByLabel(TEACH_KIND_LABEL.true_false)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('判断甲')).toBeTruthy();
    expect(screen.queryByText('编程甲')).toBeNull();
  });

  it('orders occupied kind tabs by canonical kind order, not item order', async () => {
    const { PaperView } = await loadViews();
    const onActiveKindChange = vi.fn();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'homework',
          items: [
            item({
              docId: 1, kind: 'programming', title: '编程甲', score: 20, pid: 'PG1',
            }),
            item({
              docId: 2, kind: 'true_false', title: '判断甲', score: 2, pid: 'TF2',
            }),
          ],
        })}
        initialKind={null}
        onActiveKindChange={onActiveKindChange}
      />,
    );

    expect(tabTexts()).toEqual([
      `${TEACH_KIND_LABEL.true_false}1`,
      `${TEACH_KIND_LABEL.programming}1`,
    ]);
    expect(onActiveKindChange).toHaveBeenCalledTimes(1);
    expect(onActiveKindChange).toHaveBeenCalledWith('true_false');
    expectGroupedRow('判断甲', 'TF2', '2', '2 分');
    expect(screen.queryByText('编程甲')).toBeNull();
  });

  it('shows the empty state instead of stage panels when a practice paper has no problems', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'practice',
          items: [],
          stages: [
            { id: 1, title: '顺序表', requireIds: [] },
            { id: 2, title: '链表', requireIds: [1] },
          ],
        })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    const title = screen.getByText(EMPTY_TITLE, { exact: true });
    expect(ancestorWithTokens(title, COMPACT_TOKENS)).toBeTruthy();
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeTruthy();
    expect(screen.queryByText(/阶段/)).toBeNull();
    expect(screen.queryByText('无先修')).toBeNull();
    expect(screen.queryByText('需先完成', { exact: false })).toBeNull();
    expect(panels()).toHaveLength(0);
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
  });

  it('does not show a score column on a multi-stage practice paper', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'practice',
          items: [
            item({
              docId: 1, kind: 'programming', title: '顺序查找', score: 10, stageId: 1, pid: 'R1',
            }),
            item({
              docId: 2, kind: 'single', title: '链表选择', score: 5, stageId: 2, pid: 'R2',
            }),
          ],
          stages: [
            { id: 1, title: '顺序表', requireIds: [] },
            { id: 2, title: '链表', requireIds: [1] },
          ],
        })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    expect(panels()).toHaveLength(2);
    const text = normalizedText(document.body);
    expect(text).toContain('顺序查找');
    expect(text).toContain('链表选择');
    expect(text).not.toContain('10 分');
    expect(text).not.toContain('5 分');
    expect(text).not.toContain('\u2014');
    expect(text).not.toContain('分');
  });

  it('names every prerequisite of a practice stage', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'practice',
          items: [
            item({
              docId: 1, kind: 'programming', title: '顺序查找', stageId: 1, pid: 'R1',
            }),
            item({
              docId: 2, kind: 'programming', title: '链表遍历', stageId: 2, pid: 'R2',
            }),
            item({
              docId: 3, kind: 'programming', title: '树的遍历', stageId: 3, pid: 'R3',
            }),
          ],
          stages: [
            { id: 1, title: '顺序表', requireIds: [] },
            { id: 2, title: '链表', requireIds: [] },
            { id: 3, title: '树', requireIds: [1, 2] },
          ],
        })}
        initialKind={null}
        onActiveKindChange={ignoreKind}
      />,
    );

    expect(screen.getAllByText('无先修', { exact: true })).toHaveLength(2);
    expectStyled(screen.getByText('需先完成「顺序表」、「链表」', { exact: true }), HINT_TOKENS);
  });

  it('treats a missing draw quota as zero and scores the group from that quota', async () => {
    const { PaperView } = await loadViews();
    render(
      <PaperHarness
        View={PaperView}
        state={paper({
          type: 'exam',
          draw: true,
          quotas: { programming: 1 },
          items: [
            item({
              docId: 1, kind: 'true_false', title: '判断甲', score: 3, pid: 'TF1',
            }),
            item({
              docId: 2, kind: 'true_false', title: '判断乙', score: 3, pid: 'TF2',
            }),
            item({
              docId: 3, kind: 'programming', title: '编程甲', score: 20, pid: 'PG3',
            }),
          ],
        })}
        initialKind="true_false"
        onActiveKindChange={ignoreKind}
      />,
    );

    const panel = panels()[0];
    if (!panel) throw new TypeError('quota panel');
    const text = normalizedText(panel);
    expect(text).toContain(drawLine(2, 0));
    expect(text).toContain('每题 3 分');
    expect(text).toContain('小计 0 分');
    expect(screen.queryByText(DRAW_MISMATCH)).toBeNull();
  });
});
