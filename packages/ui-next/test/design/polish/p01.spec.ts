// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, readSource } from '../helpers.ts';

const PROBLEMS = 'src/pages/problems.tsx';
const POPOVER = 'src/components/announcement-popover.tsx';

const LANE_FILES = [PROBLEMS, POPOVER] as const;

const ROW_TOKENS = ['flex', 'items-baseline', 'gap-2', 'min-w-0'] as const;
const TITLE_TOKENS = ['min-w-0', 'line-clamp-2'] as const;

type Quote = '"' | "'" | '`';

interface ClassAttribute {
  start: number;
  end: number;
  className: string;
}

interface ElementSlice {
  className: string;
  body: string;
  contentStart: number;
  contentEnd: number;
  tagStart: number;
}

function isQuote(ch: string | undefined): ch is Quote {
  return ch === '"' || ch === "'" || ch === '`';
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\w$]/.test(ch);
}

function classTokens(className: string): string[] {
  return className.split(/\s+/).filter((token) => token.length > 0);
}

function hasTokens(className: string, tokens: readonly string[]): boolean {
  const present = new Set(classTokens(className));
  return tokens.every((token) => present.has(token));
}

function hasTitle(source: string): boolean {
  return source.includes('pdoc.title') || source.includes('row.title') || source.includes('未命名题目');
}

function hasPid(source: string): boolean {
  return source.includes('displayPid') || source.includes('pdoc.pid') || source.includes('row.pid');
}

function skipLineComment(source: string, index: number): number {
  const next = source.indexOf('\n', index);
  return next < 0 ? source.length : next;
}

function skipBlockComment(source: string, index: number): number {
  const next = source.indexOf('*/', index + 2);
  return next < 0 ? source.length - 1 : next + 1;
}

function readQuoted(source: string, index: number): { value: string; next: number } | null {
  const quote = source[index];
  if (!isQuote(quote)) return null;
  let value = '';
  let i = index + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      value += source[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === quote) return { value, next: i + 1 };
    value += ch ?? '';
    i += 1;
  }
  return null;
}

function matchBrace(source: string, openIndex: number): number {
  if (source[openIndex] !== '{') return -1;
  let depth = 0;
  let quote: Quote | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i);
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function templateText(raw: string, constants: ReadonlyMap<string, string>): string {
  return raw.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (whole, name: string) => constants.get(name) ?? whole);
}

function expressionClassText(expression: string, constants: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (isQuote(ch)) {
      const quoted = readQuoted(expression, i);
      if (quoted === null) break;
      parts.push(ch === '`' ? templateText(quoted.value, constants) : quoted.value);
      i = quoted.next;
      continue;
    }
    if (ch === '/' && expression[i + 1] === '/') {
      i = skipLineComment(expression, i) + 1;
      continue;
    }
    if (ch === '/' && expression[i + 1] === '*') {
      i = skipBlockComment(expression, i) + 1;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(expression.slice(i));
    if (ident !== null) {
      const name = ident[0];
      const resolved = constants.get(name);
      if (resolved !== undefined) parts.push(resolved);
      i += name.length;
      continue;
    }
    i += 1;
  }
  return parts.join(' ');
}

function stringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const quote = match[2];
    if (name === undefined || !isQuote(quote)) continue;
    const quoted = readQuoted(source, (match.index ?? 0) + match[0].length - 1);
    if (quoted === null || quoted.value.includes('${')) continue;
    constants.set(name, quoted.value);
  }
  return constants;
}

function readClassAttribute(
  source: string,
  nameAt: number,
  constants: ReadonlyMap<string, string>,
): { end: number; className: string } | null {
  let i = nameAt + 'className'.length;
  while (source[i] === ' ' || source[i] === '\n' || source[i] === '\t') i += 1;
  if (source[i] !== '=') return null;
  i += 1;
  while (source[i] === ' ' || source[i] === '\n' || source[i] === '\t') i += 1;
  const ch = source[i];
  if (isQuote(ch)) {
    const quoted = readQuoted(source, i);
    if (quoted === null) return null;
    const className = ch === '`' ? templateText(quoted.value, constants) : quoted.value;
    return { end: quoted.next, className };
  }
  if (ch === '{') {
    const close = matchBrace(source, i);
    if (close < 0) return null;
    return {
      end: close + 1,
      className: expressionClassText(source.slice(i + 1, close), constants),
    };
  }
  return null;
}

function classAttributes(source: string, constants: ReadonlyMap<string, string>): ClassAttribute[] {
  const found: ClassAttribute[] = [];
  let quote: Quote | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i);
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
      continue;
    }
    if (source.startsWith('className', i) && !isIdentChar(source[i - 1]) && !isIdentChar(source[i + 'className'.length])) {
      const read = readClassAttribute(source, i, constants);
      if (read !== null) {
        found.push({ start: i, end: read.end, className: read.className });
        i = read.end - 1;
      }
    }
  }
  return found;
}

function isTagBoundary(source: string, index: number): boolean {
  const next = source[index];
  return next === undefined || (!/[\w.-]/.test(next));
}

function openingTagEnd(source: string, tagStart: number): number {
  let quote: Quote | null = null;
  let brace = 0;
  for (let i = tagStart; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i);
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      brace += 1;
      continue;
    }
    if (ch === '}') {
      brace -= 1;
      continue;
    }
    if (ch === '>' && brace === 0) return i;
  }
  return -1;
}

function isSelfClosing(source: string, tagStart: number, tagEnd: number): boolean {
  let i = tagEnd - 1;
  while (i > tagStart && (source[i] === ' ' || source[i] === '\n' || source[i] === '\t')) i -= 1;
  return source[i] === '/';
}

function sliceUntilClose(source: string, contentStart: number, tag: string): string {
  const openToken = `<${tag}`;
  const closeToken = `</${tag}>`;
  let depth = 1;
  let quote: Quote | null = null;
  let brace = 0;
  for (let i = contentStart; i < source.length && depth > 0; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i);
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      brace += 1;
      continue;
    }
    if (ch === '}') {
      brace -= 1;
      continue;
    }
    if (brace !== 0) continue;
    if (source.startsWith(closeToken, i)) {
      depth -= 1;
      if (depth === 0) return source.slice(contentStart, i);
      i += closeToken.length - 1;
      continue;
    }
    if (source.startsWith(openToken, i) && isTagBoundary(source, i + openToken.length)) {
      const tagEnd = openingTagEnd(source, i);
      if (tagEnd < 0) return source.slice(contentStart);
      if (!isSelfClosing(source, i, tagEnd)) depth += 1;
      i = tagEnd;
    }
  }
  return source.slice(contentStart);
}

function elementsIn(source: string): ElementSlice[] {
  const constants = stringConstants(source);
  const elements: ElementSlice[] = [];
  for (const attr of classAttributes(source, constants)) {
    const tagStart = source.lastIndexOf('<', attr.start);
    const name = /^<([A-Za-z][\w.]*)/.exec(source.slice(tagStart));
    const tag = name?.[1];
    if (tag === undefined) continue;
    const tagEnd = openingTagEnd(source, tagStart);
    if (tagEnd < 0) continue;
    if (isSelfClosing(source, tagStart, tagEnd)) {
      elements.push({
        className: attr.className,
        body: '',
        contentStart: tagEnd + 1,
        contentEnd: tagEnd + 1,
        tagStart,
      });
      continue;
    }
    const body = sliceUntilClose(source, tagEnd + 1, tag);
    elements.push({
      className: attr.className,
      body,
      contentStart: tagEnd + 1,
      contentEnd: tagEnd + 1 + body.length,
      tagStart,
    });
  }
  return elements;
}

function cardTitleRow(source: string): ElementSlice | null {
  const candidates = elementsIn(source).filter((element) => (
    classTokens(element.className).includes('items-baseline')
    && hasTitle(element.body)
    && hasPid(element.body)
  ));
  candidates.sort((left, right) => left.body.length - right.body.length);
  return candidates[0] ?? null;
}

function nestedElements(source: string, row: ElementSlice): ElementSlice[] {
  return elementsIn(source).filter((element) => (
    element.tagStart >= row.contentStart && element.tagStart < row.contentEnd
  ));
}

function widthUtilities(className: string): string[] {
  return classTokens(className).filter((token) => {
    const base = token.slice(token.lastIndexOf(':') + 1);
    return base.startsWith('w-');
  });
}

function popoverPanelClassName(source: string): string {
  const constants = stringConstants(source);
  const panels = classAttributes(source, constants).filter((attr) => {
    const tagStart = source.lastIndexOf('<', attr.start);
    return /^<Popover\b/.test(source.slice(tagStart));
  });
  expect(panels).toHaveLength(1);
  return panels[0]?.className ?? '';
}

describe('p01 problem list title row and announcement popover width', () => {
  it('卡片模式标题行含 items-baseline，题号 shrink-0，标题 line-clamp-2', () => {
    const source = readSource(PROBLEMS);
    const row = cardTitleRow(source);
    const rowClass = row?.className ?? '';
    expect(rowClass).toContain('items-baseline');
    expect(hasTokens(rowClass, ROW_TOKENS)).toBe(true);
    expect(classTokens(rowClass).includes('flex-wrap')).toBe(false);
    expect(classTokens(rowClass).includes('items-center')).toBe(false);
    if (row === null) return;

    const nested = nestedElements(source, row);
    const title = nested.find((element) => (
      classTokens(element.className).includes('line-clamp-2')
      && hasTitle(element.body)
      && !hasPid(element.body)
    ));
    const pid = nested.find((element) => (
      classTokens(element.className).includes('shrink-0')
      && hasPid(element.body)
      && !hasTitle(element.body)
    ));
    const titleClass = title?.className ?? '';
    const pidClass = pid?.className ?? '';
    expect(titleClass).toContain('line-clamp-2');
    expect(hasTokens(titleClass, TITLE_TOKENS)).toBe(true);
    expect(classTokens(titleClass).includes('truncate')).toBe(false);
    expect(pidClass).toContain('shrink-0');
  });

  it('公告弹层 className 只含一个宽度类 w-80', () => {
    const className = popoverPanelClassName(readSource(POPOVER));
    expect(widthUtilities(className)).toEqual(['w-80']);
    expect(classTokens(className)).toContain('max-w-[calc(100vw-1rem)]');
  });

  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });
});
