// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/exam-seat-plan.tsx';
const LANE_FILES = [PAGE] as const;

const ASSIGNED = ['bg-surface', 'border-line'] as const;
const SELECTED = ['border-brand', 'bg-brand-soft'] as const;
const CONFLICT = ['bg-danger-soft', 'border-danger-line'] as const;
const SCROLL_CAP = ['max-h-[min(65vh,680px)]', 'w-full', 'min-w-0'] as const;

// legacy-intents-T03 要求保留表滚动上限 max-h-[min(65vh,680px)]。
// 那是矮屏滚动，不是满高。满高只指 100dvh / 100vh / min-h-dvh / h-screen。

function classStrings(source: string): string[] {
  return [...source.matchAll(/(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g)].map((match) => match[2] ?? '');
}

function hasClass(value: string, name: string): boolean {
  const token = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${token}(?![\\w-])`).test(value);
}

function hasAllClasses(value: string, names: readonly string[]): boolean {
  return names.every((name) => hasClass(value, name));
}

function hasBrandTone(value: string): boolean {
  return /(?<![\w-])(?:bg|border|text|ring|fill|stroke)-brand\b/.test(value);
}

function openingTagAt(source: string, start: number): string {
  let quote: '"' | "'" | null = null;
  let braces = 0;
  let template = 0;
  let index = start;
  while (index < source.length) {
    const ch = source[index] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === '`') {
      template += template > 0 ? -1 : 1;
      index += 1;
      continue;
    }
    if (ch === '{') {
      braces += 1;
      index += 1;
      continue;
    }
    if (ch === '}') {
      braces = Math.max(0, braces - 1);
      index += 1;
      continue;
    }
    if (ch === '>' && braces === 0 && template === 0) {
      return source.slice(start, index + 1);
    }
    index += 1;
  }
  return '';
}

/** 座位格是渲染「空座」的那个控件。状态类必须由该控件 className 里的条件选中。 */
function seatControlTag(source: string): string {
  const labelAt = source.indexOf('空座');
  if (labelAt < 0) return '';
  const native = source.lastIndexOf('<button', labelAt);
  const component = source.lastIndexOf('<Button', labelAt);
  const start = Math.max(native, component);
  if (start < 0) return '';
  return openingTagAt(source, start);
}

function classNameExpression(tag: string): string {
  const at = tag.search(/\bclassName\s*=/);
  if (at < 0) return '';
  let index = tag.indexOf('=', at) + 1;
  while (index < tag.length && /\s/.test(tag[index] ?? '')) index += 1;
  const ch = tag[index] ?? '';
  if (ch === '"' || ch === "'") {
    const end = tag.indexOf(ch, index + 1);
    return end < 0 ? '' : tag.slice(index + 1, end);
  }
  if (ch !== '{') return '';
  let quote: '"' | "'" | null = null;
  let template = 0;
  let braces = 0;
  while (index < tag.length) {
    const cur = tag[index] ?? '';
    if (quote !== null) {
      if (cur === '\\') {
        index += 2;
        continue;
      }
      if (cur === quote) quote = null;
      index += 1;
      continue;
    }
    if (cur === '"' || cur === "'") {
      quote = cur;
      index += 1;
      continue;
    }
    if (cur === '`') {
      template += template > 0 ? -1 : 1;
      index += 1;
      continue;
    }
    if (template > 0) {
      index += 1;
      continue;
    }
    if (cur === '{') {
      braces += 1;
      index += 1;
      continue;
    }
    if (cur === '}') {
      braces -= 1;
      if (braces === 0) return tag.slice(tag.indexOf('{', at) + 1, index);
      index += 1;
      continue;
    }
    index += 1;
  }
  return '';
}

interface SeatArm {
  kind: 'when' | 'else' | 'other';
  condition: string;
  classes: string;
}

/** 条件截到最近的三元冒号、逗号或 ${ ，避免把模板前缀算进这一支。 */
function conditionTail(body: string): string {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let cut = 0;
  let index = 0;
  while (index < body.length) {
    const ch = body[index] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      if (ch === '{' && body[index - 1] === '$') cut = index + 1;
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0 && (ch === ':' || ch === ',' || ch === '?')) cut = index + 1;
    index += 1;
  }
  return body.slice(cut).trim();
}

function seatArms(source: string): SeatArm[] {
  const expression = classNameExpression(seatControlTag(source));
  expect(expression.length, '座位 className').toBeGreaterThan(0);
  const literals = [...expression.matchAll(/(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g)];
  return literals.map((match, index) => {
    const previous = index === 0
      ? 0
      : (literals[index - 1]?.index ?? 0) + (literals[index - 1]?.[0]?.length ?? 0);
    const selector = expression.slice(previous, match.index ?? 0);
    const trimmed = selector.trimEnd();
    const classes = match[2] ?? '';
    if (trimmed.endsWith('?') || trimmed.endsWith('&&')) {
      const body = trimmed.endsWith('&&') ? trimmed.slice(0, -2) : trimmed.slice(0, -1);
      return { kind: 'when', condition: conditionTail(body), classes };
    }
    if (/:\s*$/.test(selector)) return { kind: 'else', condition: '', classes };
    return { kind: 'other', condition: '', classes };
  });
}

function armsWhen(source: string, pattern: RegExp): string[] {
  const hits = seatArms(source).filter((arm) => arm.kind === 'when' && pattern.test(arm.condition));
  expect(hits.length, pattern.source).toBeGreaterThan(0);
  return hits.map((arm) => arm.classes);
}

function elseArms(source: string): string[] {
  const hits = seatArms(source).filter((arm) => arm.kind === 'else');
  expect(hits.length, '已分配 else').toBeGreaterThan(0);
  return hits.map((arm) => arm.classes);
}

function expectArmClasses(classes: string, names: readonly string[], banned: readonly string[]): void {
  expect(hasAllClasses(classes, names), `${names.join(' ')} ← ${classes}`).toBe(true);
  for (const name of banned) {
    expect(hasClass(classes, name), `${names.join(' ')} 不应含 ${name}`).toBe(false);
  }
}

function warningHosts(source: string): string[] {
  const hosts: string[] = [];
  const marker = '告警：';
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(marker, from);
    if (at < 0) break;
    const open = source.lastIndexOf('<', at);
    const close = open < 0 ? -1 : source.indexOf('>', open);
    hosts.push(open >= 0 && close > open && close < at ? source.slice(open, close + 1) : '');
    from = at + marker.length;
  }
  return hosts;
}

function bothAxisScrollCap(source: string): boolean {
  for (const match of source.matchAll(/<ScrollArea\b[^>]*>/g)) {
    const tag = match[0] ?? '';
    const both = /orientation=(?:"both"|'both'|\{\s*["']both["']\s*\})/.test(tag);
    const capped = classStrings(tag).some((value) => hasAllClasses(value, SCROLL_CAP));
    if (both && capped) return true;
  }
  return false;
}

function historyBatchButtonIsDetailsSibling(source: string): boolean {
  for (const match of source.matchAll(/<\/[Bb]utton>\s*<details\b[^>]*>[\s\S]*?<\/details>/g)) {
    const block = match[0] ?? '';
    if (block.includes('技术细节') && block.includes('requestId')) return true;
  }
  return false;
}

function hasFullHeight(source: string): boolean {
  return /100dvh|100vh|min-h-dvh|(?<![\w-])h-dvh(?![\w-])|min-h-screen|(?<![\w-])h-screen(?![\w-])/.test(source);
}

describe('e07 exam seat plan', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 exam-seat-plan.tsx', () => {
    expectPageStructure(PAGE, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
    expect(readSource(PAGE).includes('考试座位分配')).toBe(true);
  });

  it('未分配空座位带 border-dashed', () => {
    for (const value of armsWhen(readSource(PAGE), /\buid\s*===\s*null\b/)) {
      expect(hasClass(value, 'border-dashed'), value).toBe(true);
    }
  });

  it('空座位不含 bg-brand', () => {
    for (const value of armsWhen(readSource(PAGE), /\buid\s*===\s*null\b/)) {
      expect(hasClass(value, 'bg-brand'), value).toBe(false);
      expect(hasBrandTone(value), value).toBe(false);
    }
  });

  it('已分配座位同一 class 含 bg-surface 与 border-line', () => {
    for (const value of elseArms(readSource(PAGE))) {
      expectArmClasses(value, ASSIGNED, [
        'border-brand',
        'bg-brand-soft',
        'bg-danger-soft',
        'border-danger-line',
        'border-dashed',
      ]);
    }
  });

  it('选中座位同一 class 含 border-brand 与 bg-brand-soft', () => {
    for (const value of armsWhen(readSource(PAGE), /\bselectedUid\b/)) {
      expectArmClasses(value, SELECTED, [
        'bg-danger-soft',
        'border-danger-line',
        'border-dashed',
      ]);
    }
  });

  it('冲突座位同一 class 含 bg-danger-soft 与 border-danger-line', () => {
    for (const value of armsWhen(readSource(PAGE), /(?<!!)\bhasHighRisk\b/)) {
      expectArmClasses(value, CONFLICT, [
        'border-brand',
        'bg-brand-soft',
        'border-dashed',
      ]);
    }
  });

  it('告警元素含 text-warning-fg', () => {
    const hosts = warningHosts(readSource(PAGE));
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(hasClass(host, 'text-warning-fg'), host).toBe(true);
    }
  });

  it('双向滚动表容器带 max-h-[min(65vh,680px)] w-full min-w-0', () => {
    expect(bothAxisScrollCap(readSource(PAGE))).toBe(true);
  });

  it('座位表带 min-w-[56rem]', () => {
    const hit = classStrings(readSource(PAGE)).some((value) => hasClass(value, 'min-w-[56rem]'));
    expect(hit).toBe(true);
  });

  it('历史批次按钮是技术细节 details 的相邻前兄弟', () => {
    expect(historyBatchButtonIsDetailsSibling(readSource(PAGE))).toBe(true);
  });

  it('删除满高写法与 backdrop-blur', () => {
    const source = readSource(PAGE);
    expect(hasFullHeight(source)).toBe(false);
    expect(/(?<![\w-])backdrop-blur/.test(source)).toBe(false);
  });
});
