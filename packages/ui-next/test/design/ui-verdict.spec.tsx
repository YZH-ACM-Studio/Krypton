// @vitest-environment jsdom
import { type ComponentType } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Resolved when the test runs. A static import fails collection while verdict.tsx is absent.
const verdictLoaders = import.meta.glob('../../src/components/ui/verdict.tsx');

const VERDICT_SOURCE = 'src/components/ui/verdict.tsx';
const PULSE_MARK = 'kr-pulse-dot';
const MINUS = '\u2212';
const STATUS_CODES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 22, 30, 31, 32, 33] as const;

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange';
type Live = 'none' | 'pulse' | 'spin';
type ScoreTone = 'danger' | 'warning' | 'success';

interface StatusDisplay {
  label: string;
  short: string;
  tone: BadgeTone;
  live: Live;
}

interface StatusRow extends StatusDisplay {
  status: number;
}

interface DifficultyLevel {
  value: number;
  label: string;
  tone: BadgeTone;
}

interface VerdictProps {
  status: number;
  texts?: Record<string, string>;
  compact?: boolean;
  score?: number;
  size?: 'md' | 'lg';
}

interface DifficultyProps {
  level: number | null | undefined;
}

interface VerdictApi {
  statusTable: object;
  statusDisplay: (status: number, texts?: Record<string, string>) => StatusDisplay;
  Verdict: ComponentType<VerdictProps>;
  scoreTone: (score: number, full?: number) => ScoreTone;
  levels: readonly DifficultyLevel[];
  Difficulty: ComponentType<DifficultyProps>;
}

const STATUS_ROWS: readonly StatusRow[] = [
  { status: 0, label: '等待评测', short: '等待', tone: 'neutral', live: 'pulse' },
  { status: 1, label: 'Accepted', short: 'AC', tone: 'success', live: 'none' },
  { status: 2, label: 'Wrong Answer', short: 'WA', tone: 'danger', live: 'none' },
  { status: 3, label: 'Time Exceeded', short: 'TLE', tone: 'warning', live: 'none' },
  { status: 4, label: 'Memory Exceeded', short: 'MLE', tone: 'warning', live: 'none' },
  { status: 5, label: 'Output Exceeded', short: 'OLE', tone: 'warning', live: 'none' },
  { status: 6, label: 'Runtime Error', short: 'RE', tone: 'violet', live: 'none' },
  { status: 7, label: 'Compile Error', short: 'CE', tone: 'orange', live: 'none' },
  { status: 8, label: 'System Error', short: 'SE', tone: 'neutral', live: 'none' },
  { status: 9, label: 'Canceled', short: 'IGN', tone: 'neutral', live: 'none' },
  { status: 10, label: 'Unknown Error', short: 'UKE', tone: 'danger', live: 'none' },
  { status: 11, label: 'Hacked', short: 'HK', tone: 'danger', live: 'none' },
  { status: 12, label: '人工已评分', short: 'MG', tone: 'success', live: 'none' },
  { status: 20, label: 'Running', short: '评测中', tone: 'info', live: 'spin' },
  { status: 21, label: 'Compiling', short: '编译中', tone: 'info', live: 'spin' },
  { status: 22, label: 'Fetched', short: '已取题', tone: 'info', live: 'spin' },
  { status: 30, label: 'Ignored', short: 'IGN', tone: 'neutral', live: 'none' },
  { status: 31, label: 'Format Error', short: 'FE', tone: 'danger', live: 'none' },
  { status: 32, label: 'Hack Successful', short: 'HS', tone: 'success', live: 'none' },
  { status: 33, label: 'Hack Unsuccessful', short: 'HU', tone: 'danger', live: 'none' },
];

const DIFFICULTY_ROWS: readonly DifficultyLevel[] = [
  { value: 0, label: '未评定', tone: 'neutral' },
  { value: 1, label: '入门', tone: 'success' },
  { value: 2, label: `普及${MINUS}`, tone: 'info' },
  { value: 3, label: `普及/提高${MINUS}`, tone: 'info' },
  { value: 4, label: '普及+/提高', tone: 'warning' },
  { value: 5, label: `提高+/省选${MINUS}`, tone: 'warning' },
  { value: 6, label: `省选/NOI${MINUS}`, tone: 'orange' },
  { value: 7, label: '省选/NOI', tone: 'orange' },
  { value: 8, label: 'NOI/NOI+', tone: 'danger' },
  { value: 9, label: 'NOI+/CTSC', tone: 'danger' },
  { value: 10, label: 'CTSC/IOI', tone: 'violet' },
];

const ACCEPTED: StatusDisplay = {
  label: 'Accepted',
  short: 'AC',
  tone: 'success',
  live: 'none',
};

function readField(record: object, key: string): unknown {
  if (!(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key) as unknown;
}

function isBadgeTone(value: unknown): value is BadgeTone {
  return value === 'neutral'
    || value === 'brand'
    || value === 'success'
    || value === 'warning'
    || value === 'danger'
    || value === 'info'
    || value === 'violet'
    || value === 'orange';
}

function isLive(value: unknown): value is Live {
  return value === 'none' || value === 'pulse' || value === 'spin';
}

function isScoreTone(value: unknown): value is ScoreTone {
  return value === 'danger' || value === 'warning' || value === 'success';
}

function isStatusDisplay(value: unknown): value is StatusDisplay {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const label = readField(value, 'label');
  const short = readField(value, 'short');
  const tone = readField(value, 'tone');
  const live = readField(value, 'live');
  return typeof label === 'string'
    && typeof short === 'string'
    && isBadgeTone(tone)
    && isLive(live);
}

function isDifficultyLevel(value: unknown): value is DifficultyLevel {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const valueField = readField(value, 'value');
  const label = readField(value, 'label');
  const tone = readField(value, 'tone');
  return typeof valueField === 'number'
    && typeof label === 'string'
    && isBadgeTone(tone);
}

function requireObject(value: unknown, key: string): object {
  expect(typeof value, key).toBe('object');
  expect(value, key).not.toBeNull();
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${key} must be an object`);
  }
  return value;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as ComponentType<Props>;
}

function asStatusDisplayFn(value: unknown): VerdictApi['statusDisplay'] {
  expect(typeof value, 'statusDisplay').toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError('statusDisplay must be a function');
  }
  return (status, texts) => {
    const result: unknown = value(status, texts);
    expect(isStatusDisplay(result), `statusDisplay(${status})`).toBe(true);
    if (!isStatusDisplay(result)) {
      throw new TypeError(`statusDisplay(${status}) must return a status display`);
    }
    return result;
  };
}

function asScoreToneFn(value: unknown): VerdictApi['scoreTone'] {
  expect(typeof value, 'scoreTone').toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError('scoreTone must be a function');
  }
  return (score, full) => {
    const result: unknown = value(score, full);
    expect(isScoreTone(result), 'scoreTone result').toBe(true);
    if (!isScoreTone(result)) {
      throw new TypeError('scoreTone must return danger, warning, or success');
    }
    return result;
  };
}

function readLevels(value: unknown): DifficultyLevel[] {
  expect(Array.isArray(value), 'DIFFICULTY_LEVELS').toBe(true);
  if (!Array.isArray(value)) {
    throw new TypeError('DIFFICULTY_LEVELS must be an array');
  }
  const levels: DifficultyLevel[] = [];
  for (const entry of value) {
    expect(isDifficultyLevel(entry), 'DIFFICULTY_LEVELS entry').toBe(true);
    if (!isDifficultyLevel(entry)) {
      throw new TypeError('DIFFICULTY_LEVELS entry must be a level');
    }
    levels.push(entry);
  }
  return levels;
}

function verdictLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(verdictLoaders)) {
    if (key.endsWith('verdict.tsx')) {
      return load;
    }
  }
  return undefined;
}

async function loadVerdict(): Promise<VerdictApi> {
  const load = verdictLoader();
  expect(typeof load, VERDICT_SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${VERDICT_SOURCE} must exist`);
  }
  const imported: unknown = await load();
  const record = requireObject(imported, VERDICT_SOURCE);
  return {
    statusTable: requireObject(readField(record, 'STATUS_DISPLAY'), 'STATUS_DISPLAY'),
    statusDisplay: asStatusDisplayFn(readField(record, 'statusDisplay')),
    Verdict: asComponent<VerdictProps>(readField(record, 'Verdict'), 'Verdict'),
    scoreTone: asScoreToneFn(readField(record, 'scoreTone')),
    levels: readLevels(readField(record, 'DIFFICULTY_LEVELS')),
    Difficulty: asComponent<DifficultyProps>(readField(record, 'Difficulty'), 'Difficulty'),
  };
}

function rowDisplay(row: StatusRow): StatusDisplay {
  return {
    label: row.label,
    short: row.short,
    tone: row.tone,
    live: row.live,
  };
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function renderedRoot(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('expected a rendered element');
  }
  return root;
}

function toneClass(tone: BadgeTone): string {
  if (tone === 'neutral') {
    return 'text-fg-muted';
  }
  return `text-${tone}-fg`;
}

function hasPulse(root: ParentNode): boolean {
  return [...root.querySelectorAll('*')].some((element) => (
    classTokens(element).some((token) => token.includes(PULSE_MARK))
  ));
}

function dotColorClass(tone: BadgeTone): string {
  if (tone === 'neutral') {
    return 'bg-fg-subtle';
  }
  return `bg-${tone}`;
}

function statusDot(root: HTMLElement): HTMLElement {
  const dots = [...root.querySelectorAll('span')].filter((element) => {
    const tokens = classTokens(element);
    return tokens.includes('size-2')
      && tokens.includes('rounded-full')
      && !tokens.some((token) => token.includes(PULSE_MARK));
  });
  expect(dots, 'status dot').toHaveLength(1);
  const dot = dots[0];
  if (!(dot instanceof HTMLElement)) {
    throw new TypeError('expected a status dot');
  }
  return dot;
}

function expectTextOrder(root: HTMLElement, earlier: string, later: string): void {
  const earlierLeaf = smallestContaining(root, earlier);
  const laterLeaves = exactTextLeaves(root, later);
  expect(laterLeaves, later).toHaveLength(1);
  const laterLeaf = laterLeaves[0];
  if (!(laterLeaf instanceof HTMLElement)) {
    throw new TypeError(`expected ${later} after ${earlier}`);
  }
  expect(earlierLeaf.compareDocumentPosition(laterLeaf) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function visibleText(element: HTMLElement): string {
  return (element.textContent ?? '').trim();
}

function smallestContaining(root: HTMLElement, text: string): HTMLElement {
  const found = [root, ...root.querySelectorAll('*')].filter((element): element is HTMLElement => (
    element instanceof HTMLElement && (element.textContent ?? '').includes(text)
  ));
  const leaves = found.filter((element) => !found.some((other) => other !== element && element.contains(other)));
  expect(leaves, text).toHaveLength(1);
  const leaf = leaves[0];
  if (!(leaf instanceof HTMLElement)) {
    throw new TypeError(`expected text ${text}`);
  }
  return leaf;
}

function carrierWith(start: HTMLElement, root: HTMLElement, required: readonly string[]): HTMLElement | undefined {
  let current: HTMLElement | null = start;
  while (current) {
    const tokens = classTokens(current);
    if (required.every((token) => tokens.includes(token))) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = current.parentElement;
  }
  return undefined;
}

function expectTextClasses(root: HTMLElement, text: string, required: readonly string[], absent: readonly string[]): void {
  const carrier = carrierWith(smallestContaining(root, text), root, required);
  expect(carrier, required.join(' ')).toBeInstanceOf(HTMLElement);
  if (!(carrier instanceof HTMLElement)) {
    throw new TypeError(`expected ${required.join(' ')} on ${text}`);
  }
  const tokens = classTokens(carrier);
  for (const token of absent) {
    expect(tokens, token).not.toContain(token);
  }
}

function exactTextLeaves(root: ParentNode, text: string): HTMLElement[] {
  const found = [...root.querySelectorAll('*')].filter((element): element is HTMLElement => (
    element instanceof HTMLElement && visibleText(element) === text
  ));
  return found.filter((element) => !found.some((other) => other !== element && element.contains(other)));
}

function expectScore(root: HTMLElement, score: string): void {
  const leaves = exactTextLeaves(root, score);
  expect(leaves, score).toHaveLength(1);
  const leaf = leaves[0];
  if (!(leaf instanceof HTMLElement)) {
    throw new TypeError(`expected score ${score}`);
  }
  const carrier = carrierWith(leaf, root, ['tabular', 'text-fg-subtle']);
  expect(carrier, score).toBeInstanceOf(HTMLElement);
  if (!(carrier instanceof HTMLElement)) {
    throw new TypeError(`expected score classes on ${score}`);
  }
  expect(carrier).not.toBe(root);
}

function mountVerdict(Verdict: ComponentType<VerdictProps>, props: VerdictProps): { root: HTMLElement; unmount: () => void } {
  const view = render(<Verdict {...props} />);
  return { root: renderedRoot(view.container), unmount: () => view.unmount() };
}

function mountDifficulty(
  Difficulty: ComponentType<DifficultyProps>,
  level: number | null | undefined,
): { root: HTMLElement; unmount: () => void } {
  const view = render(<Difficulty level={level} />);
  return { root: renderedRoot(view.container), unmount: () => view.unmount() };
}

function expectDifficultyBadge(root: HTMLElement, value: number, label: string, tone: BadgeTone): void {
  expect(root.tagName.toLowerCase()).toBe('span');
  expect(root).toHaveAttribute('data-slot', 'badge');
  expect(root).toHaveAttribute('data-variant', 'outline');
  expect(root).toHaveAttribute('data-difficulty', String(value));
  expect(root).toHaveAttribute('data-tone', tone);
  expect(visibleText(root)).toBe(label);
  expect(classTokens(root)).toContain('h-4.5');
  expect(classTokens(root)).toContain('text-2xs');
}

describe('status display', () => {
  it('returns the Accepted row', async () => {
    const { statusDisplay } = await loadVerdict();

    expect(statusDisplay(1)).toEqual(ACCEPTED);
  });

  it('keeps the copied labels, tones, and live indicators', async () => {
    const { statusDisplay, statusTable } = await loadVerdict();

    expect(statusDisplay(0).label).toBe('等待评测');
    expect(statusDisplay(0).live).toBe('pulse');
    expect(statusDisplay(12).label).toBe('人工已评分');
    expect(statusDisplay(7).tone).toBe('orange');
    expect(statusDisplay(6).tone).toBe('violet');
    expect(statusDisplay(3).tone).toBe('warning');
    expect(statusDisplay(31).tone).toBe('danger');
    expect(statusDisplay(20).live).toBe('spin');

    for (const row of STATUS_ROWS) {
      const expected = rowDisplay(row);
      expect(statusDisplay(row.status)).toEqual(expected);
      expect(isStatusDisplay(readField(statusTable, String(row.status)))).toBe(true);
      expect(readField(statusTable, String(row.status))).toEqual(expected);
    }
  });

  it('describes an unknown status without a live indicator', async () => {
    const { statusDisplay, Verdict } = await loadVerdict();
    const expected: StatusDisplay = {
      label: 'Status 99',
      short: '?',
      tone: 'neutral',
      live: 'none',
    };

    expect(statusDisplay(99)).toEqual(expected);

    const mounted = mountVerdict(Verdict, { status: 99 });

    expect(mounted.root).toHaveAttribute('data-status', '99');
    expect(mounted.root).toHaveAttribute('data-tone', 'neutral');
    expect(classTokens(mounted.root)).toContain('text-fg-muted');
    expect(visibleText(mounted.root)).toContain('Status 99');
    expect(mounted.root.querySelector('svg')).toBeNull();
    expect(hasPulse(mounted.root)).toBe(false);
    mounted.unmount();

    const compact = mountVerdict(Verdict, { status: 99, compact: true });

    expect(visibleText(compact.root)).toBe('?');
  });

  it('lets a non-empty status text replace only the label', async () => {
    const { statusDisplay, statusTable, Verdict } = await loadVerdict();

    expect(statusDisplay(1, { 1: '通过' })).toEqual({
      label: '通过',
      short: 'AC',
      tone: 'success',
      live: 'none',
    });
    expect(statusDisplay(1, { 1: '' })).toEqual(ACCEPTED);
    expect(statusDisplay(1, {})).toEqual(ACCEPTED);
    expect(statusDisplay(1, { 2: '通过' })).toEqual(ACCEPTED);
    expect(statusDisplay(1, { 1: 'A' })).toEqual({
      label: 'A',
      short: 'AC',
      tone: 'success',
      live: 'none',
    });
    expect(statusDisplay(1, { 1: ' ' })).toEqual({
      label: ' ',
      short: 'AC',
      tone: 'success',
      live: 'none',
    });
    expect(statusDisplay(20, { 20: '运行' })).toEqual({
      label: '运行',
      short: '评测中',
      tone: 'info',
      live: 'spin',
    });
    expect(readField(statusTable, '1')).toEqual(ACCEPTED);

    const overridden = mountVerdict(Verdict, { status: 1, texts: { 1: '通过' } });

    expect(visibleText(overridden.root)).toBe('通过');
    expect(overridden.root).toHaveAttribute('data-tone', 'success');
    expect(classTokens(overridden.root)).toContain('text-success-fg');
    overridden.unmount();

    const empty = mountVerdict(Verdict, { status: 1, texts: { 1: '' } });

    expect(visibleText(empty.root)).toBe('Accepted');
    expect(empty.root).toHaveAttribute('data-tone', 'success');
    empty.unmount();

    const initial = mountVerdict(Verdict, { status: 1, texts: { 1: 'A' } });

    expect(visibleText(initial.root)).toBe('A');
    expect(initial.root).toHaveAttribute('data-tone', 'success');
    initial.unmount();

    const running = mountVerdict(Verdict, { status: 20, texts: { 20: '运行' } });

    expect(visibleText(running.root)).toContain('运行');
    expect(running.root.querySelector('svg')?.tagName.toLowerCase()).toBe('svg');
    expect(hasPulse(running.root)).toBe(false);
    expect(running.root).toHaveAttribute('data-tone', 'info');
  });

  it('lists exactly the Hydro status codes', async () => {
    const { statusTable } = await loadVerdict();
    const codes = Object.keys(statusTable).map(Number).sort((left, right) => left - right);

    expect(codes).toEqual([...STATUS_CODES]);
  });
});

describe('verdict', () => {
  it('shows Wrong Answer in danger and the short code when compact', async () => {
    const { Verdict } = await loadVerdict();
    const mounted = mountVerdict(Verdict, { status: 2 });

    expect(mounted.root.tagName.toLowerCase()).toBe('span');
    expect(mounted.root).toHaveAttribute('data-status', '2');
    expect(mounted.root).toHaveAttribute('data-tone', 'danger');
    expect(classTokens(mounted.root)).toContain('text-danger-fg');
    expect(visibleText(mounted.root)).toContain('Wrong Answer');
    expectTextClasses(mounted.root, 'Wrong Answer', ['text-sm', 'font-medium'], ['text-md', 'font-semibold']);
    expect(mounted.root.querySelector('svg')).toBeNull();
    expect(hasPulse(mounted.root)).toBe(false);
    mounted.unmount();

    const compact = mountVerdict(Verdict, { status: 2, compact: true });

    expect(visibleText(compact.root)).toBe('WA');
    expect(compact.root).toHaveAttribute('data-tone', 'danger');
    expect(classTokens(compact.root)).toContain('text-danger-fg');
  });

  it('spins while judging and does not pulse', async () => {
    const { Verdict } = await loadVerdict();
    const mounted = mountVerdict(Verdict, { status: 20 });
    const spinner = mounted.root.querySelector('svg');

    expect(mounted.root).toHaveAttribute('data-status', '20');
    expect(mounted.root).toHaveAttribute('data-tone', 'info');
    expect(classTokens(mounted.root)).toContain('text-info-fg');
    expect(spinner?.tagName.toLowerCase()).toBe('svg');
    if (!(spinner instanceof Element)) {
      throw new TypeError('expected the judging spinner');
    }
    expect(classTokens(spinner)).toContain('size-3.5');
    expect(classTokens(spinner)).not.toContain('size-4');
    expect(hasPulse(mounted.root)).toBe(false);
    expect(mounted.root.firstElementChild).toBe(spinner);
  });

  it('pulses while waiting and keeps a quiet dot for a settled neutral status', async () => {
    const { Verdict } = await loadVerdict();
    const waiting = mountVerdict(Verdict, { status: 0 });

    expect(waiting.root).toHaveAttribute('data-tone', 'neutral');
    expect(classTokens(waiting.root)).toContain('text-fg-muted');
    expect(classTokens(waiting.root)).not.toContain('text-neutral-fg');
    expect(visibleText(waiting.root)).toContain('等待评测');
    expect(waiting.root.querySelector('svg')).toBeNull();
    expect(hasPulse(waiting.root)).toBe(true);
    waiting.unmount();

    const system = mountVerdict(Verdict, { status: 8 });

    expect(system.root).toHaveAttribute('data-tone', 'neutral');
    expect(classTokens(system.root)).toContain('text-fg-muted');
    expect(system.root.querySelector('svg')).toBeNull();
    expect(hasPulse(system.root)).toBe(false);
  });

  it('renders every known status with its label, tone class, and indicator', async () => {
    const { Verdict } = await loadVerdict();

    for (const row of STATUS_ROWS) {
      const mounted = mountVerdict(Verdict, { status: row.status });

      expect(mounted.root.tagName.toLowerCase()).toBe('span');
      expect(mounted.root).toHaveAttribute('data-status', String(row.status));
      expect(mounted.root).toHaveAttribute('data-tone', row.tone);
      expect(classTokens(mounted.root)).toContain(toneClass(row.tone));
      expect(visibleText(mounted.root)).toContain(row.label);
      expectTextClasses(mounted.root, row.label, ['text-sm', 'font-medium'], ['text-md', 'font-semibold']);
      const spinner = mounted.root.querySelector('svg');
      if (row.live === 'spin') {
        expect(spinner?.tagName.toLowerCase()).toBe('svg');
        expect(hasPulse(mounted.root)).toBe(false);
        if (!(spinner instanceof Element)) {
          throw new TypeError(`expected a spinner for status ${row.status}`);
        }
        expect(classTokens(spinner)).toContain('size-3.5');
      } else {
        expect(spinner).toBeNull();
        expect(hasPulse(mounted.root)).toBe(row.live === 'pulse');
      }
      mounted.unmount();

      const compact = mountVerdict(Verdict, { status: row.status, compact: true });

      expect(visibleText(compact.root)).toBe(row.short);
      compact.unmount();
    }
  });

  it('uses large text only when size is lg', async () => {
    const { Verdict } = await loadVerdict();
    const large = mountVerdict(Verdict, { status: 2, size: 'lg' });

    expect(visibleText(large.root)).toContain('Wrong Answer');
    expectTextClasses(large.root, 'Wrong Answer', ['text-md', 'font-semibold'], ['text-sm', 'font-medium']);
    expect(large.root).toHaveAttribute('data-tone', 'danger');
  });

  it('shows a score, including zero, beside the verdict', async () => {
    const { Verdict } = await loadVerdict();
    const full = mountVerdict(Verdict, { status: 1, score: 100 });

    expect(visibleText(full.root)).toContain('Accepted');
    expect(visibleText(full.root)).toContain('100');
    expectScore(full.root, '100');
    expectTextOrder(full.root, 'Accepted', '100');
    full.unmount();

    const zero = mountVerdict(Verdict, { status: 1, score: 0 });

    expect(visibleText(zero.root)).toContain('Accepted');
    expectScore(zero.root, '0');
    expectTextOrder(zero.root, 'Accepted', '0');
  });

  it('colors the status dot with the verdict tone', async () => {
    const { Verdict } = await loadVerdict();

    for (const row of STATUS_ROWS) {
      if (row.live === 'spin') {
        continue;
      }
      const mounted = mountVerdict(Verdict, { status: row.status });

      expect(classTokens(statusDot(mounted.root))).toContain(dotColorClass(row.tone));
      mounted.unmount();
    }
  });
});

describe('score tone', () => {
  it('maps a score against the full mark', async () => {
    const { scoreTone } = await loadVerdict();
    const cases: ReadonlyArray<{ score: number; full?: number; tone: ScoreTone }> = [
      { score: 0, tone: 'danger' },
      { score: 50, tone: 'warning' },
      { score: 100, tone: 'success' },
      { score: 140, tone: 'success' },
      { score: -20, tone: 'danger' },
      { score: 30, full: 30, tone: 'success' },
      { score: Number.NaN, tone: 'danger' },
      { score: 0, full: 0, tone: 'danger' },
      { score: 29, full: 30, tone: 'warning' },
      { score: 0.5, tone: 'warning' },
      { score: 1, tone: 'warning' },
      { score: 99, tone: 'warning' },
      { score: 99.6, tone: 'warning' },
      { score: 0.4, full: 0.5, tone: 'warning' },
      { score: 0.5, full: 0.5, tone: 'success' },
    ];

    for (const entry of cases) {
      expect(scoreTone(entry.score, entry.full)).toBe(entry.tone);
    }
  });
});

describe('difficulty', () => {
  it('copies the eleven difficulty levels', async () => {
    const { levels } = await loadVerdict();

    expect(levels).toHaveLength(11);
    expect(levels[4]).toEqual({ value: 4, label: '普及+/提高', tone: 'warning' });
    expect(levels[10]?.tone).toBe('violet');
    expect(levels).toEqual(DIFFICULTY_ROWS);
  });

  it('renders an outline badge and treats a non integer level as unrated', async () => {
    const { Difficulty } = await loadVerdict();
    const rated = mountDifficulty(Difficulty, 7);

    expectDifficultyBadge(rated.root, 7, '省选/NOI', 'orange');
    rated.unmount();

    for (const level of [null, 11, undefined, Number.NaN, 1.5, -1, 10.5]) {
      const unrated = mountDifficulty(Difficulty, level);

      expectDifficultyBadge(unrated.root, 0, '未评定', 'neutral');
      unrated.unmount();
    }

    for (const row of DIFFICULTY_ROWS) {
      const mounted = mountDifficulty(Difficulty, row.value);

      expectDifficultyBadge(mounted.root, row.value, row.label, row.tone);
      mounted.unmount();
    }
  });
});
