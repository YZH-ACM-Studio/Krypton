// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const WORKSPACE = 'src/pages/domain-permission-workspace.tsx';
const M06 = 'test/design/pages/m06.design.spec.ts';

function openTagEnd(source: string, start: number): number {
  let quote = '';
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote !== '') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (char === '>' && depth === 0) return index;
  }
  return -1;
}

function classText(tag: string): string {
  const quoted = /className=(?:"([^"]*)"|'([^']*)')/.exec(tag);
  if (quoted !== null) return quoted[1] ?? quoted[2] ?? '';
  const expression = /className=\{([\s\S]*?)\}/.exec(tag);
  return expression?.[1] ?? '';
}

function permissionMatrixShell(source: string): string {
  const matrix = findOpenTags(source, 'Table').find((tag) => {
    const at = source.indexOf(tag.text);
    if (at < 0) return false;
    const close = source.indexOf('</Table>', at);
    if (close < 0) return false;
    return source.slice(at, close).includes('权限');
  });
  if (matrix === undefined) {
    throw new TypeError('domain-permission-workspace.tsx 没有权限矩阵 Table');
  }
  const at = source.indexOf(matrix.text);
  const divAt = source.lastIndexOf('<div', at);
  if (divAt < 0) {
    throw new TypeError('权限矩阵 Table 没有外层 div');
  }
  const end = openTagEnd(source, divAt);
  if (end < 0) {
    throw new TypeError('权限矩阵外层 div 没有闭合');
  }
  return source.slice(divAt, end + 1);
}

/** Variant prefix is allowed: `[&_.krypton-table-shell]:max-h-96` still counts. */
function hasMaxHeightClass(className: string): boolean {
  return className.split(/\s+/).some((token) => /(?:^|:)max-h-/.test(token));
}

function keepsRadixContentBlock(tag: string, className: string): boolean {
  return className.includes('!block') || tag.includes('viewportClassName');
}

function isIdentChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function regexPredecessor(chars: readonly string[], slashAt: number): boolean {
  let cursor = slashAt - 1;
  while (cursor >= 0 && /\s/.test(chars[cursor] ?? '')) cursor -= 1;
  if (cursor < 0) return true;
  const prev = chars[cursor] ?? '';
  if ('([{:;,=!&|?'.includes(prev)) return true;
  const start = cursor;
  while (cursor >= 0 && isIdentChar(chars[cursor])) cursor -= 1;
  return chars.slice(cursor + 1, start + 1).join('') === 'return';
}

/** Blank comments, strings, and regexes so brace matching ignores them. Length stays the same. */
function maskNonCode(source: string): string {
  const chars = source.split('');
  const blank = (at: number) => {
    if (chars[at] !== undefined && chars[at] !== '\n') chars[at] = ' ';
  };
  let index = 0;
  let quote = '';
  while (index < chars.length) {
    const char = chars[index] ?? '';
    if (quote !== '') {
      if (char === '\\') {
        blank(index);
        blank(index + 1);
        index += 2;
        continue;
      }
      if (char === quote) quote = '';
      else blank(index);
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      index += 1;
      continue;
    }
    if (char === '/' && chars[index + 1] === '/') {
      while (index < chars.length && chars[index] !== '\n') {
        blank(index);
        index += 1;
      }
      continue;
    }
    if (char === '/' && chars[index + 1] === '*') {
      blank(index);
      index += 1;
      blank(index);
      index += 1;
      while (index < chars.length && (chars[index] !== '*' || chars[index + 1] !== '/')) {
        blank(index);
        index += 1;
      }
      blank(index);
      blank(index + 1);
      index += 2;
      continue;
    }
    if (char === '/' && regexPredecessor(chars, index)) {
      blank(index);
      index += 1;
      while (index < chars.length && chars[index] !== '/' && chars[index] !== '\n') {
        if (chars[index] === '\\') {
          blank(index);
          blank(index + 1);
          index += 2;
          continue;
        }
        blank(index);
        index += 1;
      }
      blank(index);
      index += 1;
      continue;
    }
    index += 1;
  }
  return chars.join('');
}

function itRanges(masked: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (!masked.startsWith('it(', index) || isIdentChar(masked[index - 1])) continue;
    const arrow = masked.indexOf('=>', index);
    const open = arrow < 0 ? -1 : masked.indexOf('{', arrow);
    if (open < 0) {
      throw new TypeError('m06 的 it( 回调没有函数体');
    }
    let depth = 0;
    let end = -1;
    for (let cursor = open; cursor < masked.length; cursor += 1) {
      const char = masked[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    if (end < 0) throw new TypeError('m06 的 it( 回调没有闭合');
    ranges.push({ start: open + 1, end });
    index = end;
  }
  return ranges;
}

function topLevelExcerpt(body: string): string {
  const masked = maskNonCode(body);
  let depth = 0;
  let text = '';
  for (let index = 0; index < body.length; index += 1) {
    const structural = masked[index];
    if (structural === '{') {
      depth += 1;
      continue;
    }
    if (structural === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth === 0) text += body[index] ?? '';
  }
  return text;
}

function stickyBindings(body: string): Set<string> {
  const names = new Set<string>();
  for (const match of body.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*usesStickyTable\s*\(/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

interface Conditional {
  condition: string;
  body: string;
}

function conditionals(body: string): Conditional[] {
  const masked = maskNonCode(body);
  const blocks: Conditional[] = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (!masked.startsWith('if', index) || isIdentChar(masked[index - 1]) || isIdentChar(masked[index + 2])) {
      continue;
    }
    const paren = masked.indexOf('(', index);
    if (paren < 0 || masked.slice(index + 2, paren).trim() !== '') continue;
    let depth = 0;
    let conditionEnd = -1;
    for (let cursor = paren; cursor < masked.length; cursor += 1) {
      const char = masked[cursor];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          conditionEnd = cursor;
          break;
        }
      }
    }
    if (conditionEnd < 0) continue;
    let cursor = conditionEnd + 1;
    while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
    if (masked[cursor] === '{') {
      let blockDepth = 0;
      let close = -1;
      for (let at = cursor; at < masked.length; at += 1) {
        const char = masked[at];
        if (char === '{') blockDepth += 1;
        else if (char === '}') {
          blockDepth -= 1;
          if (blockDepth === 0) {
            close = at;
            break;
          }
        }
      }
      if (close < 0) continue;
      blocks.push({
        condition: body.slice(paren + 1, conditionEnd),
        body: body.slice(cursor + 1, close),
      });
      index = close;
      continue;
    }
    const semi = masked.indexOf(';', cursor);
    const stop = semi < 0 ? body.length : semi;
    blocks.push({ condition: body.slice(paren + 1, conditionEnd), body: body.slice(cursor, stop) });
    if (semi >= 0) index = semi;
  }
  return blocks;
}

function skipsWhenStickyTrue(condition: string, names: ReadonlySet<string>): boolean {
  if (/!\s*usesStickyTable\s*\(/.test(condition)) return true;
  for (const name of names) {
    if (new RegExp(`!\\s*${name}\\b`).test(condition)) return true;
  }
  return false;
}

function affirmsSticky(condition: string, names: ReadonlySet<string>): boolean {
  const trimmed = condition.trim();
  if (/^usesStickyTable\s*\(/.test(trimmed)) return true;
  for (const name of names) {
    if (trimmed === name || trimmed === `${name} === true` || trimmed === `${name} == true`) return true;
  }
  return false;
}

function checksScrollBound(text: string): boolean {
  return text.includes('horizontalScrollTrapsSticky')
    || /(?:^|[^A-Za-z0-9-])max-h-/.test(text)
    || text.includes('!block')
    || text.includes('viewportClassName');
}

function hasUnconditionalBound(text: string): boolean {
  return /(?:^|[^A-Za-z0-9-])max-h-/.test(text)
    && (text.includes('!block') || text.includes('viewportClassName'));
}

/**
 * `usesStickyTable(...)` 为真时跳过滚动祖先检查，含 `if (usesStickyTable) return`。
 * 修正后，某个 it 的顶层（不在 if 内）必须同时断言 max-h- 与 !block / viewportClassName。
 */
function m06Problems(source: string): string[] {
  const masked = maskNonCode(source);
  const problems: string[] = [];
  let directReturn = false;
  let skipped = false;
  let unconditional = false;
  for (const range of itRanges(masked)) {
    const body = source.slice(range.start, range.end);
    const names = stickyBindings(body);
    for (const block of conditionals(body)) {
      if (affirmsSticky(block.condition, names) && /^\s*return\b/.test(block.body)) directReturn = true;
      if (skipsWhenStickyTrue(block.condition, names) && checksScrollBound(block.body)) skipped = true;
    }
    if (hasUnconditionalBound(topLevelExcerpt(body))) unconditional = true;
  }
  if (directReturn) problems.push('m06 出现 if (usesStickyTable) 后直接 return');
  if (skipped) problems.push('usesStickyTable 为真时仍跳过滚动祖先检查');
  if (!unconditional) {
    problems.push('m06 没有无条件断言权限矩阵容器同时含 max-h- 与 !block 或 viewportClassName');
  }
  return problems;
}

describe('q05 permission matrix sticky header', () => {
  it('权限矩阵外层 className 含有界高度，并让 Radix 内容层变成 block', () => {
    const shell = permissionMatrixShell(readSource(WORKSPACE));
    const className = classText(shell);
    expect(hasMaxHeightClass(className)).toBe(true);
    expect(keepsRadixContentBlock(shell, className)).toBe(true);
  });

  it('m06 不再用 usesStickyTable 短路跳过有界滚动检查', () => {
    expect(m06Problems(readSource(M06))).toEqual([]);
  });

  it('权限矩阵页面通过设计门禁', () => {
    expectGateClean([WORKSPACE]);
  });
});
