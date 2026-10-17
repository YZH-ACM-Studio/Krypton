// A static import fails collection while paper-pane.tsx is absent.
import { useState, type ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext, useDndContext } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';
import { TEACH_ALLOWED_KINDS } from '@hydrooj/common';
import type { ProblemKind, TeachStatus } from '@hydrooj/common';
import { composeReducer, initialComposeState } from '../../src/pages/teach/compose/draft.ts';
import type { ComposeAction, ComposeState } from '../../src/pages/teach/compose/draft.ts';
import { TEACH_KIND_LABEL } from '../../src/pages/teach/model.ts';
import type { PaperItem, PaperStage, PaperState } from '../../src/pages/teach/paper.ts';

const paneLoaders = import.meta.glob('../../src/pages/teach/compose/paper-pane.tsx');

const PANE_SOURCE = 'src/pages/teach/compose/paper-pane.tsx';
const DECOY = '底稿题';
const DOT = '\u00B7';
const GROUP_HINT = '拖进来的题会自动放进对应题型组；在组内拖动可以调整顺序。把题拖回左边就是移出。';
const STAGE_HINT = '拖到哪个阶段，就加到哪个阶段。把题拖回左边就是移出。';
const FLAT_HINT = '拖到两题之间就插在那里，题号随顺序自动变。把题拖回左边就是移出。';
const EMPTY_DRAG = '从左边把题拖到这里，或点题目右侧的「+」。';
const QUOTA_ALERT = '打开了随机抽题，但每组都是 0 道。';
const MIXED_BADGE = '抽题时本组必须同分';
const EXCEEDS_BADGE = '抽题数超过题数';
const STAGE_DROP = '拖题到这里';
const HEADER_TOKENS = ['flex', 'flex-wrap', 'items-center', 'gap-x-4', 'gap-y-1', 'border-b', 'border-line-subtle', 'px-4', 'py-3', 'text-sm'] as const;
const SHEET_TOKENS = ['mx-auto', 'flex', 'w-full', 'max-w-4xl', 'flex-col', 'gap-4', 'p-4'] as const;
const COUNT_TOKENS = ['inline-block', 'w-5', 'text-right', 'text-xs', 'tabular', 'text-fg-subtle'] as const;
const HINT_TOKENS = ['text-center', 'text-xs', 'text-fg-subtle'] as const;
const COMPACT_TOKENS = ['gap-2', 'px-4', 'py-8'] as const;
const STAGE_LINE_TOKENS = ['text-sm', 'text-fg-subtle'] as const;
const PREREQ_TOKENS = ['text-xs', 'text-fg-subtle'] as const;

type User = ReturnType<typeof userEvent.setup>;
type ActionOf<T extends ComposeAction['type']> = Extract<ComposeAction, { type: T }>;

interface PaperPaneProps {
  state: ComposeState;
  dispatch: (action: ComposeAction) => void;
}

interface DropSnapshot {
  id: string;
  from: unknown;
  to: unknown;
  docId: unknown;
  kind: unknown;
  stageId: unknown;
}

interface HarnessProps {
  Pane: ComponentType<PaperPaneProps>;
  initial: ComposeState;
  dispatched: ComposeAction[];
  drops: { current: DropSnapshot[] };
}

interface RenderedPane {
  user: User;
  dispatched: ComposeAction[];
  drops: { current: DropSnapshot[] };
}

function readField(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent(value: unknown): ComponentType<PaperPaneProps> {
  if (typeof value !== 'function') throw new TypeError('PaperPane must be a function');
  return value as ComponentType<PaperPaneProps>;
}

async function loadPane(): Promise<ComponentType<PaperPaneProps>> {
  const load = Object.entries(paneLoaders).find(([key]) => key.endsWith(PANE_SOURCE))?.[1];
  expect(typeof load, `${PANE_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${PANE_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${PANE_SOURCE} must be a module`);
  return asComponent(readField(imported, 'PaperPane'));
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function hasAll(element: Element, tokens: readonly string[]): boolean {
  const actual = classTokens(element);
  return tokens.every((token) => actual.includes(token));
}

function ancestorWithTokens(element: Element, tokens: readonly string[]): HTMLElement | null {
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLElement && hasAll(current, tokens)) return current;
    current = current.parentElement;
  }
  return null;
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function problem(fields: {
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

function paperOf(fields: {
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

function composeOf(current: PaperState, status: TeachStatus = 'upcoming'): ComposeState {
  const state = initialComposeState(current, status);
  const base = paperOf({
    type: current.type,
    rule: current.rule,
    items: [problem({
      docId: 99999, kind: 'programming', title: DECOY, pid: 'BASE',
    })],
    stages: current.stages,
  });
  return { ...state, base };
}

function snapshotFrom(id: unknown, raw: unknown): DropSnapshot {
  const record = typeof raw === 'object' && raw !== null ? raw : {};
  return {
    id: String(id),
    from: readField(record, 'from'),
    to: readField(record, 'to'),
    docId: readField(record, 'docId'),
    kind: readField(record, 'kind'),
    stageId: readField(record, 'stageId'),
  };
}

function DropProbe({ drops }: { drops: { current: DropSnapshot[] } }) {
  const { droppableContainers } = useDndContext();
  const next: DropSnapshot[] = [];
  for (const container of droppableContainers.toArray()) next.push(snapshotFrom(container.id, container.data.current));
  drops.current = next;
  return null;
}

function PaperHarness({
  Pane, initial, dispatched, drops,
}: HarnessProps) {
  const [state, setState] = useState(initial);
  const dispatch = (action: ComposeAction) => {
    dispatched.push(action);
    setState((current) => composeReducer(current, action));
  };
  return (
    <DndContext>
      <Pane state={state} dispatch={dispatch} />
      <DropProbe drops={drops} />
    </DndContext>
  );
}

function renderPane(Pane: ComponentType<PaperPaneProps>, initial: ComposeState): RenderedPane {
  const dispatched: ComposeAction[] = [];
  const drops: { current: DropSnapshot[] } = { current: [] };
  render(
    <PaperHarness Pane={Pane} initial={initial} dispatched={dispatched} drops={drops} />,
  );
  return { user: userEvent.setup(), dispatched, drops };
}

function ofType<T extends ComposeAction['type']>(actions: readonly ComposeAction[], type: T): ActionOf<T>[] {
  return actions.filter((action): action is ActionOf<T> => action.type === type);
}

function paperRegion(): HTMLElement {
  const region = screen.getByRole('region', { name: '试卷' });
  expect(region.tagName).toBe('SECTION');
  return region;
}

function expectShell() {
  const region = paperRegion();
  expect(screen.queryByText(DECOY)).toBeNull();
  const scroll = [...region.querySelectorAll('div')].find((node) => hasAll(node, ['min-h-0', 'overflow-hidden']));
  const sheet = [...region.querySelectorAll('div')].find((node) => hasAll(node, SHEET_TOKENS));
  if (!(scroll instanceof HTMLElement) || !(sheet instanceof HTMLElement)) throw new TypeError('paper shell');
  expect(region.contains(scroll)).toBe(true);
  expect(scroll.contains(sheet)).toBe(true);
}

function panels(): HTMLElement[] {
  return [...document.querySelectorAll('[data-slot="panel"]')].filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function onlyPanel(): HTMLElement {
  expect(panels()).toHaveLength(1);
  const panel = panels()[0];
  if (!panel) throw new TypeError('panel');
  expectFlush(panel);
  return panel;
}

function expectFlush(panel: HTMLElement) {
  const body = panel.firstElementChild;
  if (!(body instanceof HTMLElement)) throw new TypeError('panel body');
  expect(classTokens(body)).not.toContain('p-4');
}

function headerOf(panel: HTMLElement): HTMLElement {
  const header = [...panel.querySelectorAll('*')].find((node) => hasAll(node, HEADER_TOKENS));
  if (!(header instanceof HTMLElement)) throw new TypeError('group header');
  return header;
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

function examTabCount(kind: ProblemKind): number {
  if (kind === 'single') return 2;
  if (kind === 'programming') return 1;
  return 0;
}

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

function rowByTitle(title: string): HTMLElement {
  const titleNode = screen.getByText(title, { exact: true });
  let current: HTMLElement | null = titleNode.parentElement;
  while (current) {
    const removes = [...current.querySelectorAll('button')].filter((button) => (
      (button.getAttribute('aria-label') ?? '').startsWith('移出')
    ));
    if (removes.length === 1) return current;
    current = current.parentElement;
  }
  throw new TypeError(`row ${title}`);
}

function rowScore(title: string): HTMLInputElement {
  const input = rowByTitle(title).querySelector('input[type="number"]');
  if (!(input instanceof HTMLInputElement)) throw new TypeError(`score ${title}`);
  return input;
}

function asInput(node: HTMLElement, label: string): HTMLInputElement {
  if (!(node instanceof HTMLInputElement)) throw new TypeError(label);
  return node;
}

function labeledNumber(name: string): HTMLInputElement {
  return asInput(screen.getByRole('spinbutton', { name }), name);
}

function expectSmNumber(input: HTMLInputElement) {
  expect(input).toHaveAttribute('type', 'number');
  expect(classTokens(input)).toEqual(expect.arrayContaining(['w-16', 'h-(--control-sm)']));
}

function expectIconButton(button: HTMLElement) {
  expect(button).toHaveAttribute('data-variant', 'ghost');
  expect(button).toHaveAttribute('data-size', 'sm');
  expect(classTokens(button)).toContain('w-(--control-sm)');
  expect(button.querySelector('svg')?.tagName.toLowerCase()).toBe('svg');
}

function expectHint(text: string) {
  const node = screen.getByText(text, { exact: true });
  const host = ancestorWithTokens(node, HINT_TOKENS);
  if (!host) throw new TypeError(`hint ${text}`);
  expect(classTokens(host)).toEqual(expect.arrayContaining([...HINT_TOKENS]));
}

function expectNoHints() {
  expect(screen.queryByText(GROUP_HINT)).toBeNull();
  expect(screen.queryByText(STAGE_HINT)).toBeNull();
  expect(screen.queryByText(FLAT_HINT)).toBeNull();
}

function drop(drops: { current: DropSnapshot[] }, id: string): DropSnapshot {
  const found = drops.current.find((entry) => entry.id === id);
  if (!found) {
    throw new TypeError(`missing droppable ${id}; have ${drops.current.map((entry) => entry.id).join(',')}`);
  }
  return found;
}

function paperIds(drops: { current: DropSnapshot[] }): string[] {
  return drops.current.map((entry) => entry.id).filter((id) => id.startsWith('paper:')).sort();
}

async function replaceNumber(user: User, input: HTMLInputElement, text: string) {
  await user.clear(input);
  if (text.length > 0) await user.type(input, text);
}

function emptyTitle(kind: ProblemKind): string {
  return `还没有${TEACH_KIND_LABEL[kind]}。`;
}

function stageHeader(index: number, title: string): string {
  return `阶段 ${index} ${DOT} ${title}`;
}

function badge(text: string): HTMLElement {
  const found = screen.getByText(text, { exact: true }).closest('[data-slot="badge"]');
  if (!(found instanceof HTMLElement)) throw new TypeError(`badge ${text}`);
  return found;
}

const TWO_SINGLES = [
  problem({
    docId: 11, kind: 'single', title: '单选甲', score: 2, pid: 'SG1', hidden: true,
  }),
  problem({
    docId: 12, kind: 'single', title: '单选乙', score: 2, pid: 'SG2',
  }),
];

describe('compose paper pane', () => {
  it('letters an acm paper without kind tabs', async () => {
    const Pane = await loadPane();
    const { drops } = renderPane(Pane, composeOf(paperOf({
      type: 'acm',
      items: [
        problem({
          docId: 11, kind: 'programming', title: '遍历', pid: 'A11',
        }),
        problem({
          docId: 12, kind: 'function', title: '最短路', pid: 'A12',
        }),
      ],
    })));

    expectShell();
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    expect(screen.queryByText('草稿')).toBeNull();
    const panel = onlyPanel();
    expectLeafOrder(panel, ['A', 'A11', '遍历', 'B', 'A12', '最短路']);
    expect(normalizedText(panel)).not.toContain('分');
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    const handles = screen.getAllByRole('button', { name: '拖动排序' });
    expect(handles).toHaveLength(2);
    for (const handle of handles) expectIconButton(handle);
    for (const button of screen.getAllByRole('button', { name: /^移出 / })) expectIconButton(button);
    expectHint(FLAT_HINT);
    expect(screen.queryByText(GROUP_HINT)).toBeNull();
    expect(screen.queryByText(STAGE_HINT)).toBeNull();
    expect(drop(drops, 'group:flat')).toMatchObject({ to: 'paper', kind: null, stageId: null });
    expect(drop(drops, 'paper:11')).toMatchObject({ from: 'paper', docId: 11 });
    expect(drop(drops, 'paper:12')).toMatchObject({ from: 'paper', docId: 12 });
    expect(paperIds(drops)).toEqual(['paper:11', 'paper:12']);
  });

  it('keeps a zero-count exam tab and shows its empty state', async () => {
    const Pane = await loadPane();
    const { user, dispatched, drops } = renderPane(Pane, composeOf(paperOf({
      type: 'exam',
      items: [
        ...TWO_SINGLES,
        problem({
          docId: 21, kind: 'programming', title: '编程甲', score: 20, pid: 'PG1',
        }),
      ],
    })));

    expectShell();
    expect(screen.queryAllByRole('tablist')).toHaveLength(1);
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', '题型');
    expect(tabTexts()).toEqual(
      TEACH_ALLOWED_KINDS.exam.map((kind) => `${TEACH_KIND_LABEL[kind]}${examTabCount(kind)}`),
    );
    expect(countSlot(tabByLabel('判断题')).textContent).toBe('0');
    expect(tabByLabel('单选题')).toHaveAttribute('aria-selected', 'true');
    const singlePanel = onlyPanel();
    const header = headerOf(singlePanel);
    expect(classTokens(within(header).getByText('单选题', { exact: true }))).toContain('font-medium');
    const headerText = normalizedText(header);
    expect(headerText).toContain('2 道');
    expect(headerText).toContain('每题');
    expect(headerText).toContain('小计 4 分');
    expect(headerText).not.toContain('每人抽');
    expectSmNumber(labeledNumber('单选题每题分值'));
    expect(labeledNumber('单选题每题分值')).toHaveValue(2);
    expect(screen.queryByRole('spinbutton', { name: '单选题每人抽题数' })).toBeNull();
    expectLeafOrder(singlePanel, ['1', 'SG1', '单选甲', '2', 'SG2', '单选乙']);
    expect(screen.queryByText('编程甲')).toBeNull();
    expect(screen.queryByText('草稿')).toBeNull();
    expectHint(GROUP_HINT);
    expect(drop(drops, 'group:single')).toMatchObject({ to: 'paper', kind: 'single', stageId: null });
    expect(paperIds(drops)).toEqual(['paper:11', 'paper:12']);
    expect(drops.current.some((entry) => entry.id === 'group:true_false')).toBe(false);

    await user.click(tabByLabel('编程题'));

    expect(ofType(dispatched, 'setActiveKind')).toEqual([{ type: 'setActiveKind', kind: 'programming' }]);
    expect(tabByLabel('编程题')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('单选甲')).toBeNull();
    const programmingPanel = onlyPanel();
    expect(within(programmingPanel).getByText('3', { exact: true })).toBeTruthy();
    expect(within(programmingPanel).getByText('编程甲')).toBeTruthy();
    expect(normalizedText(headerOf(programmingPanel))).toContain('小计 20 分');
    expect(drop(drops, 'group:programming')).toMatchObject({ to: 'paper', kind: 'programming', stageId: null });
    expect(paperIds(drops)).toEqual(['paper:21']);

    await user.click(tabByLabel('判断题'));

    expect(ofType(dispatched, 'setActiveKind').at(-1)).toEqual({ type: 'setActiveKind', kind: 'true_false' });
    expect(tabByLabel('判断题')).toHaveAttribute('aria-selected', 'true');
    const emptyPanel = onlyPanel();
    const empty = within(emptyPanel).getByText(emptyTitle('true_false'), { exact: true });
    expect(ancestorWithTokens(empty, COMPACT_TOKENS)).toBeTruthy();
    expect(within(emptyPanel).getByText(EMPTY_DRAG, { exact: true })).toBeTruthy();
    expect(screen.queryByText('编程甲')).toBeNull();
    expect(drop(drops, 'group:true_false')).toMatchObject({ to: 'paper', kind: 'true_false', stageId: null });
    expect(paperIds(drops)).toEqual([]);
    expectHint(GROUP_HINT);
  });

  it('keeps a draw quota and the over-quota badge on an empty kind', async () => {
    const Pane = await loadPane();
    const { user, dispatched } = renderPane(Pane, composeOf(paperOf({
      type: 'exam',
      draw: true,
      quotas: { true_false: 2 },
      items: [problem({
        docId: 11, kind: 'single', title: '单选甲', score: 2, pid: 'SG1',
      })],
    })));

    await user.click(tabByLabel('判断题'));

    expect(ofType(dispatched, 'setActiveKind')).toEqual([{ type: 'setActiveKind', kind: 'true_false' }]);
    const quota = labeledNumber('判断题每人抽题数');
    expectSmNumber(quota);
    expect(quota).toHaveValue(2);
    const exceeds = badge(EXCEEDS_BADGE);
    expect(exceeds).toHaveAttribute('data-tone', 'danger');
    const empty = screen.getByText(emptyTitle('true_false'), { exact: true });
    expect(exceeds.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await replaceNumber(user, labeledNumber('判断题每人抽题数'), '0');
    expect(ofType(dispatched, 'setQuota')).toEqual([]);
    await user.tab();
    expect(ofType(dispatched, 'setQuota')).toEqual([{ type: 'setQuota', kind: 'true_false', count: 0 }]);
    expect(screen.queryByText(EXCEEDS_BADGE)).toBeNull();
    expect(labeledNumber('判断题每人抽题数')).toHaveValue(0);
    expect(screen.getByText(emptyTitle('true_false'), { exact: true })).toBeTruthy();
  });

  it('hides the footer when a grouped paper has no problems', async () => {
    const Pane = await loadPane();
    const { drops } = renderPane(Pane, composeOf(paperOf({ type: 'exam', items: [] })));

    expectShell();
    expect(countSlot(tabByLabel('判断题')).textContent).toBe('0');
    expect(tabByLabel('判断题')).toHaveAttribute('aria-selected', 'true');
    const emptyPanel = onlyPanel();
    expect(within(emptyPanel).getByText(emptyTitle('true_false'), { exact: true })).toBeTruthy();
    expectNoHints();
    expect(drop(drops, 'group:true_false')).toMatchObject({ to: 'paper', kind: 'true_false', stageId: null });
    expect(paperIds(drops)).toEqual([]);
  });

  it('commits a group score on blur or enter and restores illegal scores', async () => {
    const Pane = await loadPane();
    const { user, dispatched } = renderPane(Pane, composeOf(paperOf({
      type: 'homework',
      items: TWO_SINGLES,
    })));
    const scores = () => ofType(dispatched, 'setGroupScore');
    expectShell();
    expectSmNumber(labeledNumber('单选题每题分值'));
    expect(labeledNumber('单选题每题分值')).toHaveValue(2);

    await replaceNumber(user, labeledNumber('单选题每题分值'), '0');
    expect(scores()).toEqual([]);
    await user.tab();
    expect(scores()).toEqual([]);
    expect(labeledNumber('单选题每题分值')).toHaveValue(2);

    await replaceNumber(user, labeledNumber('单选题每题分值'), '1001');
    await user.tab();
    expect(scores()).toEqual([]);
    expect(labeledNumber('单选题每题分值')).toHaveValue(2);

    await user.clear(labeledNumber('单选题每题分值'));
    await user.tab();
    expect(scores()).toEqual([]);
    expect(labeledNumber('单选题每题分值')).toHaveValue(2);

    await replaceNumber(user, labeledNumber('单选题每题分值'), '5');
    expect(scores()).toEqual([]);
    await user.tab();
    expect(scores()).toEqual([{ type: 'setGroupScore', kind: 'single', score: 5 }]);
    expect(labeledNumber('单选题每题分值')).toHaveValue(5);
    expect(rowScore('单选甲')).toHaveValue(5);
    expect(rowScore('单选乙')).toHaveValue(5);
    expect(normalizedText(headerOf(onlyPanel()))).toContain('小计 10 分');

    await replaceNumber(user, labeledNumber('单选题每题分值'), '0');
    await user.tab();
    expect(scores()).toEqual([{ type: 'setGroupScore', kind: 'single', score: 5 }]);
    expect(labeledNumber('单选题每题分值')).toHaveValue(5);

    await replaceNumber(user, labeledNumber('单选题每题分值'), '6');
    expect(scores()).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(scores()).toEqual([
      { type: 'setGroupScore', kind: 'single', score: 5 },
      { type: 'setGroupScore', kind: 'single', score: 6 },
    ]);
    expect(labeledNumber('单选题每题分值')).toHaveValue(6);
  });

  it('commits a quota on blur or enter and restores a negative quota', async () => {
    const Pane = await loadPane();
    const { user, dispatched } = renderPane(Pane, composeOf(paperOf({
      type: 'exam',
      draw: true,
      quotas: { single: 2 },
      items: TWO_SINGLES,
    })));
    const quotas = () => ofType(dispatched, 'setQuota');
    const quota = () => labeledNumber('单选题每人抽题数');
    expectShell();
    expectSmNumber(quota());
    expect(quota()).toHaveValue(2);
    expect(screen.queryByText(QUOTA_ALERT)).toBeNull();
    const headerText = normalizedText(headerOf(onlyPanel()));
    expect(headerText).toContain('2 道');
    expect(headerText).toContain('每人抽');
    expect(headerText).toContain('小计 4 分');

    await replaceNumber(user, quota(), '0');
    expect(quotas()).toEqual([]);
    await user.tab();
    expect(quotas()).toEqual([{ type: 'setQuota', kind: 'single', count: 0 }]);
    expect(quota()).toHaveValue(0);
    expect(screen.getByText(QUOTA_ALERT, { exact: true })).toBeTruthy();

    await replaceNumber(user, quota(), '-1');
    await user.tab();
    expect(quotas()).toEqual([{ type: 'setQuota', kind: 'single', count: 0 }]);
    expect(quota()).toHaveValue(0);

    await replaceNumber(user, quota(), '3');
    expect(quotas()).toHaveLength(1);
    await user.tab();
    expect(quotas()).toEqual([
      { type: 'setQuota', kind: 'single', count: 0 },
      { type: 'setQuota', kind: 'single', count: 3 },
    ]);
    expect(quota()).toHaveValue(3);
    expect(screen.queryByText(QUOTA_ALERT)).toBeNull();

    await replaceNumber(user, quota(), '4');
    await user.keyboard('{Enter}');
    expect(quotas().at(-1)).toEqual({ type: 'setQuota', kind: 'single', count: 4 });
    expect(quota()).toHaveValue(4);
  });

  it('shows the quota alert at the top of the paper', async () => {
    const Pane = await loadPane();
    renderPane(Pane, composeOf(paperOf({
      type: 'exam',
      draw: true,
      quotas: { single: 0 },
      items: [problem({
        docId: 11, kind: 'single', title: '单选甲', score: 2, pid: 'SG1',
      })],
    })));

    expectShell();
    const alertText = screen.getByText(QUOTA_ALERT, { exact: true });
    const alert = alertText.closest('[role="status"]');
    if (!(alert instanceof HTMLElement)) throw new TypeError('quota alert');
    expect(classTokens(alert)).toEqual(expect.arrayContaining(['border-warning-line', 'bg-warning-soft']));
    const tabs = screen.getByRole('tablist');
    expect(alert.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(tabByLabel('单选题')).toHaveAttribute('aria-selected', 'true');
    expect(labeledNumber('单选题每人抽题数')).toHaveValue(0);
    expect(screen.queryByText(MIXED_BADGE)).toBeNull();
    expect(screen.queryByText(EXCEEDS_BADGE)).toBeNull();
  });

  it('shows mixed-score and over-quota badges on the drawn group', async () => {
    const Pane = await loadPane();
    renderPane(Pane, composeOf(paperOf({
      type: 'exam',
      draw: true,
      quotas: { programming: 5 },
      items: [
        problem({
          docId: 31, kind: 'programming', title: '编程甲', score: 20, pid: 'PG1',
        }),
        problem({
          docId: 32, kind: 'programming', title: '编程乙', score: 10, pid: 'PG2',
        }),
      ],
    })));

    expectShell();
    expect(tabByLabel('编程题')).toHaveAttribute('aria-selected', 'true');
    expect(badge(MIXED_BADGE)).toHaveAttribute('data-tone', 'warning');
    expect(badge(EXCEEDS_BADGE)).toHaveAttribute('data-tone', 'danger');
    expect(screen.queryByText(QUOTA_ALERT)).toBeNull();
    expect(labeledNumber('编程题每人抽题数')).toHaveValue(5);
    expect(labeledNumber('编程题每题分值')).toBeTruthy();
    const headerText = normalizedText(headerOf(onlyPanel()));
    expect(headerText).toContain('2 道');
    expect(headerText).toContain('小计 30 分');
  });

  it('removes a problem through dispatch', async () => {
    const Pane = await loadPane();
    const { user, dispatched } = renderPane(Pane, composeOf(paperOf({
      type: 'acm',
      items: [
        problem({
          docId: 11, kind: 'programming', title: '遍历', pid: 'A11',
        }),
        problem({
          docId: 12, kind: 'programming', title: '最短路', pid: 'A12',
        }),
      ],
    })));
    const remove = screen.getByRole('button', { name: '移出 A11' });
    expectIconButton(remove);

    await user.click(remove);

    expect(ofType(dispatched, 'remove')).toEqual([{ type: 'remove', docId: 11 }]);
    expect(screen.queryByText('遍历')).toBeNull();
    expect(screen.getByText('最短路')).toBeTruthy();
    expect(within(onlyPanel()).getByText('A', { exact: true })).toBeTruthy();
    expect(screen.queryByText('B', { exact: true })).toBeNull();
  });

  it('hides drag handles and disables inputs while locked', async () => {
    const Pane = await loadPane();
    renderPane(Pane, composeOf(paperOf({
      type: 'exam',
      draw: true,
      quotas: { single: 1 },
      items: TWO_SINGLES,
    }), 'running'));

    expectShell();
    expect(screen.queryAllByRole('button', { name: '拖动排序' })).toHaveLength(0);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input).toBeDisabled();
    expect(labeledNumber('单选题每题分值')).toBeDisabled();
    expect(labeledNumber('单选题每人抽题数')).toBeDisabled();
    expect(rowScore('单选甲')).toBeDisabled();
    expect(rowScore('单选乙')).toBeDisabled();
    expect(screen.getByText('单选甲')).toBeTruthy();
  });

  it('shows oi scores on a flat paper', async () => {
    const Pane = await loadPane();
    const { drops } = renderPane(Pane, composeOf(paperOf({
      type: 'oi',
      rule: 'oi',
      items: [
        problem({
          docId: 41, kind: 'function', title: '函数甲', score: 10, pid: 'O41',
        }),
        problem({
          docId: 42, kind: 'programming', title: '编程甲', score: 20, pid: 'O42',
        }),
      ],
    })));

    expectShell();
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    const panel = onlyPanel();
    expectLeafOrder(panel, ['A', 'O41', '函数甲', 'B', 'O42', '编程甲']);
    expectSmNumber(rowScore('函数甲'));
    expect(rowScore('函数甲')).toHaveValue(10);
    expect(rowScore('编程甲')).toHaveValue(20);
    expectHint(FLAT_HINT);
    expect(drop(drops, 'group:flat')).toMatchObject({ to: 'paper', kind: null, stageId: null });
    expect(drop(drops, 'paper:41')).toMatchObject({ from: 'paper', docId: 41 });
    expect(paperIds(drops)).toEqual(['paper:41', 'paper:42']);
  });

  it('commits a row score on blur and restores zero', async () => {
    const Pane = await loadPane();
    const { user, dispatched } = renderPane(Pane, composeOf(paperOf({
      type: 'oi',
      rule: 'oi',
      items: [
        problem({
          docId: 41, kind: 'function', title: '函数甲', score: 10, pid: 'O41',
        }),
        problem({
          docId: 42, kind: 'programming', title: '编程甲', score: 20, pid: 'O42',
        }),
      ],
    })));
    const scores = () => ofType(dispatched, 'setItemScore');

    await replaceNumber(user, rowScore('函数甲'), '0');
    expect(scores()).toEqual([]);
    await user.tab();
    expect(scores()).toEqual([]);
    expect(ofType(dispatched, 'setGroupScore')).toEqual([]);
    expect(rowScore('函数甲')).toHaveValue(10);

    await replaceNumber(user, rowScore('函数甲'), '15');
    expect(scores()).toEqual([]);
    await user.tab();
    expect(scores()).toEqual([{ type: 'setItemScore', docId: 41, score: 15 }]);
    expect(rowScore('函数甲')).toHaveValue(15);
    expect(rowScore('编程甲')).toHaveValue(20);
  });

  it('shows one practice stage as a single numeric list', async () => {
    const Pane = await loadPane();
    const { drops } = renderPane(Pane, composeOf(paperOf({
      type: 'practice',
      items: [
        problem({
          docId: 1, kind: 'programming', title: '顺序查找', stageId: 7, pid: 'R1',
        }),
        problem({
          docId: 2, kind: 'programming', title: '二分查找', stageId: 7, pid: 'R2',
        }),
      ],
      stages: [{ id: 7, title: '顺序表', requireIds: [] }],
    }), 'open'));

    expectShell();
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    expect(screen.queryByText(/阶段/)).toBeNull();
    expect(screen.queryByText('A', { exact: true })).toBeNull();
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    const panel = onlyPanel();
    expectLeafOrder(panel, ['1', 'R1', '顺序查找', '2', 'R2', '二分查找']);
    expect(screen.queryByText(STAGE_DROP)).toBeNull();
    const groups = drops.current.filter((entry) => entry.id.startsWith('group:'));
    expect(groups).toHaveLength(1);
    expect(paperIds(drops)).toEqual(['paper:1', 'paper:2']);
  });

  it('splits practice stages and drops onto each stage', async () => {
    const Pane = await loadPane();
    const stages: PaperStage[] = [
      { id: 7, title: '顺序表', requireIds: [] },
      { id: 8, title: '链表', requireIds: [7] },
      { id: 9, title: '树', requireIds: [] },
    ];
    const { drops } = renderPane(Pane, composeOf(paperOf({
      type: 'practice',
      items: [
        problem({
          docId: 1, kind: 'programming', title: '顺序查找', stageId: 7, pid: 'R1',
        }),
        problem({
          docId: 2, kind: 'single', title: '链表选择', stageId: 8, pid: 'R2',
        }),
      ],
      stages,
    }), 'open'));

    expectShell();
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(panels()).toHaveLength(3);
    const [first, second, third] = panels();
    if (!first || !second || !third) throw new TypeError('stage panels');
    expectFlush(first);
    expectFlush(second);
    expectFlush(third);
    expect(screen.getByText(stageHeader(1, '顺序表'), { exact: true })).toBeTruthy();
    expect(screen.getByText(stageHeader(2, '链表'), { exact: true })).toBeTruthy();
    expect(screen.getByText(stageHeader(3, '树'), { exact: true })).toBeTruthy();
    const prereqs = screen.getAllByText('无先修', { exact: true });
    expect(prereqs).toHaveLength(2);
    for (const prereq of prereqs) expect(ancestorWithTokens(prereq, PREREQ_TOKENS)).toBeTruthy();
    const required = screen.getByText('需先完成「顺序表」', { exact: true });
    expect(ancestorWithTokens(required, PREREQ_TOKENS)).toBeTruthy();
    expect(within(first).getByText('1', { exact: true })).toBeTruthy();
    expect(within(first).getByText('顺序查找')).toBeTruthy();
    expect(within(second).getByText('2', { exact: true })).toBeTruthy();
    expect(within(second).queryByText('1', { exact: true })).toBeNull();
    const emptyLine = within(third).getByText(STAGE_DROP, { exact: true });
    expect(ancestorWithTokens(emptyLine, STAGE_LINE_TOKENS)).toBeTruthy();
    expectHint(STAGE_HINT);
    expect(screen.queryByText(FLAT_HINT)).toBeNull();
    expect(screen.queryByText(GROUP_HINT)).toBeNull();
    expect(drop(drops, 'group:stage-7')).toMatchObject({ to: 'paper', kind: null, stageId: 7 });
    expect(drop(drops, 'group:stage-8')).toMatchObject({ to: 'paper', kind: null, stageId: 8 });
    expect(drop(drops, 'group:stage-9')).toMatchObject({ to: 'paper', kind: null, stageId: 9 });
    expect(drop(drops, 'paper:1')).toMatchObject({ from: 'paper', docId: 1 });
    expect(drop(drops, 'paper:2')).toMatchObject({ from: 'paper', docId: 2 });
    expect(paperIds(drops)).toEqual(['paper:1', 'paper:2']);
  });
});
