// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const FILE = 'src/pages/contests.tsx';

// legacy-intents T01–T04 没有源文件 src/pages/contests.tsx，因此没有意图用例。

function source(): string {
  return readSource(FILE);
}

function section(text: string, start: string, end: string | null): string {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  if (end === null) return text.slice(from);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from, to);
}

function hasPageWidth(text: string, width: 'wide' | 'full'): boolean {
  return [...text.matchAll(/<Page\b[^>]*>/g)].some((match) => match[0].includes(`width="${width}"`));
}

function extractCnCalls(text: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf('cn(', from);
    if (at < 0) break;
    let depth = 0;
    let quote: string | null = null;
    let closed = false;
    for (let i = at + 2; i < text.length; i += 1) {
      const char = text.charAt(i);
      if (quote) {
        if (char === '\\') {
          i += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          bodies.push(text.slice(at + 3, i));
          from = i + 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) break;
  }
  return bodies;
}

function splitArgs(body: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const char = body.charAt(i);
    if (quote) {
      current += char;
      if (char === '\\') {
        current += body.charAt(i + 1);
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function widthTokens(text: string): string[] {
  return [...text.matchAll(/\b(?:min-)?w-(\d+)\b/g)].map((match) => match[1] ?? '').filter((token) => token !== '');
}

function statementAt(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(';', index), text.lastIndexOf('{', index), text.lastIndexOf('}', index));
  const end = text.indexOf(';', index);
  return text.slice(start + 1, end === -1 ? text.length : end);
}

/** 第一列宽度记号必须等于第二列 sticky 的 left 记号，不能只出现 sticky left-0。 */
function expectSecondColumnStickyMatchesRankWidth(board: string): void {
  const blocks = extractCnCalls(board).filter((body) => body.includes('sticky left-0'));
  expect(blocks.length).toBeGreaterThan(0);
  let rankWidth: string | null = null;
  const offsets: string[] = [];
  for (const body of blocks) {
    const widths: string[] = [];
    for (const arg of splitArgs(body)) {
      const sticky = /sticky left-(\d+)/.exec(arg);
      const pinsFirst = arg.includes('=== 0') || arg.includes('== 0');
      if (sticky && pinsFirst && sticky[1] === '0') {
        widths.push(...widthTokens(arg));
        continue;
      }
      if (sticky && sticky[1] !== '0') {
        offsets.push(sticky[1] ?? '');
        continue;
      }
      if (pinsFirst) continue;
      const elseBranch = /:\s*'([^']*)'/.exec(arg);
      if (elseBranch?.[1]) {
        widths.push(...widthTokens(elseBranch[1]));
        continue;
      }
      if (!arg.includes('?') && !arg.includes('&&')) widths.push(...widthTokens(arg));
    }
    if (widths.length === 0) continue;
    expect(new Set(widths).size).toBe(1);
    const token = widths[0] ?? '';
    if (rankWidth === null) rankWidth = token;
    expect(token).toBe(rankWidth);
  }
  expect(rankWidth).not.toBeNull();
  expect(offsets.length).toBeGreaterThan(0);
  for (const offset of offsets) expect(offset).toBe(rankWidth);
}

/** icon-check 或带换行的 +n 才是通过；仅含 color:orange 的 +n 是封榜，不能画成通过色。 */
function expectScoreCellsTieToneToMarkers(board: string): void {
  const successAt = board.indexOf('bg-success-soft text-success-fg');
  expect(successAt).toBeGreaterThanOrEqual(0);
  const fnStart = board.lastIndexOf('function ', successAt);
  const fnEnd = board.indexOf('\n  function ', successAt);
  expect(fnStart).toBeGreaterThanOrEqual(0);
  expect(fnEnd).toBeGreaterThan(fnStart);
  const tone = board.slice(fnStart, fnEnd);
  expect(tone).toContain('icon-check');
  expect(tone).toContain('bg-success-soft text-success-fg');
  expect(tone).toContain('bg-info-soft text-info-fg');
  const infoAt = tone.indexOf('bg-info-soft text-info-fg');
  expect(tone.slice(Math.max(0, infoAt - 200), infoAt)).toMatch(/orange/);
  const plusHits = [...tone.matchAll(/startsWith\('\+'\)/g)];
  if (plusHits.length === 0) {
    expect(tone).toMatch(/\\n/);
    return;
  }
  for (const hit of plusHits) {
    const statement = statementAt(tone, hit.index ?? 0);
    expect(statement).toMatch(/&&/);
    expect(statement).toMatch(/\\n/);
  }
}

describe('s07 contests list, detail and scoreboard', () => {
  it('门禁零违规', () => {
    expectGateClean([FILE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([FILE]);
  });

  it('页面结构 src/pages/contests.tsx', () => {
    expectPageStructure(FILE, {
      widths: ['wide', 'full'],
      workspace: 'forbidden',
      minPageHeaders: 3,
    });
  });

  it('比赛列表和详情使用宽页', () => {
    const text = source();
    const list = section(text, 'export function ContestsPage(', 'export function ContestDetailPage(');
    const detail = section(text, 'export function ContestDetailPage(', 'export function ContestScoreboardPage(');
    expect(hasPageWidth(list, 'wide')).toBe(true);
    expect(list).toContain('<PageHeader');
    expect(hasPageWidth(detail, 'wide')).toBe(true);
    expect(detail).toContain('<PageHeader');
    expect(text).toContain('lg:grid-cols-[minmax(0,1fr)_17.5rem]');
    expect(text).not.toContain('text-3xl');
    expect(text).not.toContain('lg:grid-cols-[minmax(0,1fr)_280px]');
  });

  it('比赛卡片用表面卡片、StatusDot 和赛制徽章', () => {
    const text = source();
    expect(text).toContain('rounded-lg border border-line bg-surface p-4 shadow-xs');
    expect(text).toContain('hover:border-line-strong');
    expect(text).toContain('hover:shadow-sm');
    expect(text).not.toContain('hover:shadow-md');
    expect(text).toContain('grid gap-4 sm:grid-cols-2 lg:grid-cols-3');
    expect(text).not.toContain('grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]');
    expect(text).toMatch(/<StatusDot\b/);
    expect(text).toMatch(/<StatusDot\b[^>]+\bpulse\b/);
    expect(text).toContain('进行中');
    expect(text).toContain('即将开始');
    expect(text).toContain('已结束');
    const badges = [...text.matchAll(/<Badge\b([^>]*)>/g)].map((match) => match[1] ?? '');
    expect(badges.some((tag) => tag.includes('variant="outline"') && tag.includes('size="sm"'))).toBe(true);
    expect(text).not.toMatch(/variant=\{ruleBadgeVariant\(/);
  });

  it('排行榜是全宽页且单元格按榜单色', () => {
    const text = source();
    const board = section(text, 'export function ContestScoreboardPage(', null);
    expect(hasPageWidth(board, 'full')).toBe(true);
    expect(board).toContain('<PageHeader');
    expect(text).toContain('bg-success-soft text-success-fg');
    expect(text).toContain('bg-success text-on-success');
    expect(text).toContain('bg-danger-soft text-danger-fg');
    expect(text).toContain('bg-info-soft text-info-fg');
    expect(text).toContain('sticky left-0');
    expect(text).toContain('3xl:text-md');
  });

  it('通过格认 icon-check 或换行的 +n，橙色 +n 认封榜', () => {
    expectScoreCellsTieToneToMarkers(section(source(), 'export function ContestScoreboardPage(', null));
  });

  it('第二列 sticky 的 left 等于第一列宽度', () => {
    expectSecondColumnStickyMatchesRankWidth(section(source(), 'export function ContestScoreboardPage(', null));
  });

  it('没有页面入场动画和数字时长', () => {
    const text = source();
    expect(text).not.toMatch(/initial=\{\{\s*(?:opacity:\s*0\b|[xy]:)/);
    expect(text).not.toMatch(/\bwhile(?:Hover|InView|Tap)\b/);
    expect(text).not.toMatch(/(?<![\w-])(?:duration|delay)-\d+(?![\w-])/);
    expect(text).not.toMatch(/\b(?:duration|delay)\s*:\s*\d/);
  });
});
