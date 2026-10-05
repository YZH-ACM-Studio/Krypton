// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/cn';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const FILE = 'src/components/team-code-snapshots.tsx';
const SHEET = 'src/components/ui/sheet.tsx';
const SAFE_AREA = 'pb-[env(safe-area-inset-bottom)]';
const NARROW_ROWS = 'grid-rows-[minmax(0,40%)_minmax(0,1fr)]';
const MD_ROWS = 'md:grid-rows-[minmax(0,1fr)]';
const MD_COLS = 'md:grid-cols-[19rem_minmax(0,1fr)]';

// 结构规格是「组件：只要求门禁零违规」。通用规格写明组件文件不写 expectPageStructure。
// SheetContent 把调用方 className 放在 cn() 最后一位，p-* 会盖掉组件自带的 pb 安全区。

function skipString(source: string, open: number): number {
  const quote = source[open] ?? '';
  for (let cursor = open + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (source[cursor] === quote) return cursor;
  }
  return source.length;
}

function stringLiterals(source: string): string[] {
  const values: string[] = [];
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char !== '"' && char !== "'" && char !== '`') continue;
    const end = skipString(source, cursor);
    const text = source.slice(cursor + 1, end);
    if (!text.includes('${')) values.push(text);
    cursor = end;
  }
  return values;
}

function stripComments(source: string): string {
  let out = '';
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    const next = source[cursor + 1];
    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(source, cursor);
      out += source.slice(cursor, end + 1);
      cursor = end;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', cursor);
      cursor = end < 0 ? source.length : end;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end < 0 ? source.length : end + 1;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

function readBalanced(source: string, open: number, openChar: string, closeChar: string): string {
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === '`') {
      cursor = skipString(source, cursor);
      continue;
    }
    if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(open, cursor + 1);
    }
  }
  return '';
}

function readCall(source: string, openIndex: number): string {
  return readBalanced(source, openIndex, '(', ')');
}

function functionSource(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const rest = source.slice(start + marker.length);
  const next = rest.search(/\n(?:export )?function /);
  return next < 0 ? source.slice(start) : source.slice(start, start + marker.length + next);
}

function cnCallContaining(fnSource: string, needle: string): string {
  let from = 0;
  while (from < fnSource.length) {
    const at = fnSource.indexOf('cn(', from);
    if (at < 0) return '';
    const call = readCall(fnSource, at + 2);
    if (call.includes(needle)) return call;
    from = at + 3;
  }
  return '';
}

function attributeExpression(source: string, equalsEnd: number): string {
  let cursor = equalsEnd;
  while (source[cursor] === ' ' || source[cursor] === '\n' || source[cursor] === '\t') cursor += 1;
  const char = source[cursor];
  if (char === '"' || char === "'") {
    const end = skipString(source, cursor);
    return source.slice(cursor, end + 1);
  }
  if (char === '{') return readBalanced(source, cursor, '{', '}');
  return '';
}

function mergedClassNameValues(source: string): string[] {
  const merged: string[] = [];
  for (const match of source.matchAll(/(?<![\w-])className\s*=/g)) {
    const equalsEnd = (match.index ?? 0) + match[0].length;
    const literals = stringLiterals(attributeExpression(source, equalsEnd)).filter((value) => value.length > 0);
    if (literals.length === 0) continue;
    merged.push(cn(...literals));
  }
  return merged;
}

function classTokens(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function snapshotGridTokens(source: string): string[] {
  for (const merged of mergedClassNameValues(stripComments(source))) {
    const tokens = classTokens(merged);
    if (
      tokens.includes('grid')
      && tokens.includes(NARROW_ROWS)
      && tokens.includes(MD_ROWS)
      && tokens.includes(MD_COLS)
    ) {
      return tokens;
    }
  }
  return [];
}

function sheetContentSafeAreaClass(sheetSource: string): string {
  const call = cnCallContaining(functionSource(sheetSource, 'SheetContent'), SAFE_AREA);
  return stringLiterals(call).find((value) => classTokens(value).includes(SAFE_AREA)) ?? '';
}

function callerClassName(tag: string): string {
  const match = /(?<![\w-])className\s*=/.exec(tag);
  if (match?.index === undefined) return '';
  const literals = stringLiterals(attributeExpression(tag, match.index + match[0].length));
  return literals.length === 0 ? '' : cn(...literals);
}

describe('e05 team code snapshots drawer', () => {
  it('门禁零违规', () => {
    expectGateClean([FILE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([FILE]);
  });

  it('代码快照抽屉的 SheetContent 不得带 overflow-y-auto', () => {
    const tags = findOpenTags(readSource(FILE), 'SheetContent');
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag.text).not.toMatch(/overflow-y-auto/);
    }
  });

  it('传入的 className 经 cn() 合并后仍保留 SheetContent 安全区 padding', () => {
    const base = sheetContentSafeAreaClass(readSource(SHEET));
    expect(classTokens(base)).toContain(SAFE_AREA);
    const tags = findOpenTags(readSource(FILE), 'SheetContent');
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(classTokens(cn(base, callerClassName(tag.text)))).toContain(SAFE_AREA);
    }
  });

  it('代码快照抽屉在窄屏把上下两栏限制在 40% 与剩余高度', () => {
    expect(snapshotGridTokens(readSource(FILE))).toContain(NARROW_ROWS);
  });

  it('中屏及以上取消上下分栏，改成单行撑满', () => {
    expect(snapshotGridTokens(readSource(FILE))).toContain(MD_ROWS);
  });

  it('中屏及以上左侧列表固定 19rem，右侧内容占据剩余宽度', () => {
    expect(snapshotGridTokens(readSource(FILE))).toContain(MD_COLS);
  });

  it('快照面板不得再用 18rem 的硬性最小高度', () => {
    expect(readSource(FILE)).not.toMatch(/min-h-\[18rem\]/);
  });

  it('使用 Sheet 系列组件', () => {
    const src = readSource(FILE);
    expect(src).toMatch(/import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*'@\/components\/ui\/sheet'/);
    expect(src).toMatch(/<Sheet[\s>]/);
    expect(src).toMatch(/<SheetContent[\s>]/);
    expect(src).toMatch(/<SheetHeader[\s>]/);
    expect(src).toMatch(/<SheetTitle[\s>]/);
  });

  it('不挂 ToastProvider，代码快照成功提示文案不变', () => {
    const src = readSource(FILE);
    expect(src.includes('ToastProvider')).toBe(false);
    expect(src.includes("toast.success('代码快照已保存'")).toBe(true);
  });
});
