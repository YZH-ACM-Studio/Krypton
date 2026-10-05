// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const MANAGE = 'src/pages/contest-exam-manage.tsx';
const SCORE = 'src/pages/contest-exam-score-batch.tsx';
const POOL = 'src/pages/contest-exam-paper-pool.tsx';

type Quote = '"' | "'" | '`';

interface Span {
  start: number;
  end: number;
}

interface ElementSpan {
  start: number;
  text: string;
  body: string;
  line: number;
}

function isQuote(ch: string | undefined): ch is Quote {
  return ch === '"' || ch === "'" || ch === '`';
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isTagBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === '>' || ch === '/' || /\s/.test(ch);
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function skipLineComment(source: string, index: number): number {
  const next = source.indexOf('\n', index);
  return next < 0 ? source.length : next + 1;
}

function skipBlockComment(source: string, index: number): number {
  const next = source.indexOf('*/', index + 2);
  return next < 0 ? source.length : next + 2;
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

function matchPair(source: string, openIndex: number, open: string, close: string): number {
  if (source[openIndex] !== open) return -1;
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
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
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
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i) - 1;
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
      if (brace > 0) brace -= 1;
      continue;
    }
    if (ch === '>' && brace === 0) return i;
  }
  return -1;
}

function isSelfClosing(source: string, tagStart: number, tagEnd: number): boolean {
  let i = tagEnd - 1;
  while (i > tagStart && /\s/.test(source[i] ?? '')) i -= 1;
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
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i) - 1;
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
      if (brace > 0) brace -= 1;
      continue;
    }
    if (brace !== 0) continue;
    if (source.startsWith(closeToken, i)) {
      depth -= 1;
      if (depth === 0) return source.slice(contentStart, i);
      i += closeToken.length - 1;
      continue;
    }
    if (source.startsWith(openToken, i) && isTagBoundary(source[i + openToken.length]) && !isIdentChar(source[i - 1])) {
      const tagEnd = openingTagEnd(source, i);
      if (tagEnd < 0) return source.slice(contentStart);
      if (!isSelfClosing(source, i, tagEnd)) depth += 1;
      i = tagEnd;
    }
  }
  return source.slice(contentStart);
}

function scanCode(source: string, visit: (index: number) => number): void {
  let quote: Quote | null = null;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
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
      i += 1;
      continue;
    }
    const next = visit(i);
    i = next > i ? next : i + 1;
  }
}

function findElements(source: string, tag: string): ElementSpan[] {
  const found: ElementSpan[] = [];
  const needle = `<${tag}`;
  scanCode(source, (index) => {
    if (!source.startsWith(needle, index)) return index;
    if (!isTagBoundary(source[index + needle.length])) return index;
    if (isIdentChar(source[index - 1])) return index;
    const openEnd = openingTagEnd(source, index);
    if (openEnd < 0) return index;
    const text = source.slice(index, openEnd + 1);
    const body = isSelfClosing(source, index, openEnd) ? '' : sliceUntilClose(source, openEnd + 1, tag);
    found.push({
      start: index,
      text,
      body,
      line: lineOf(source, index),
    });
    return index;
  });
  return found;
}

function attributeRanges(source: string, name: string): Span[] {
  const ranges: Span[] = [];
  scanCode(source, (index) => {
    if (!source.startsWith(name, index)) return index;
    if (isIdentChar(source[index - 1]) || isIdentChar(source[index + name.length])) return index;
    let cursor = index + name.length;
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== '=') return index;
    cursor += 1;
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    if (source[cursor] !== '{') return index;
    const end = matchPair(source, cursor, '{', '}');
    if (end >= 0) ranges.push({ start: cursor, end });
    return index;
  });
  return ranges;
}

function stringLiterals(source: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (!isQuote(ch)) continue;
    const quoted = readQuoted(source, i);
    if (quoted === null) break;
    parts.push(quoted.value);
    i = quoted.next - 1;
  }
  return parts;
}

function classText(openTag: string): string {
  const match = /\bclassName\s*=/.exec(openTag);
  if (match === null || match.index === undefined) return '';
  let index = match.index + match[0].length;
  while (/\s/.test(openTag[index] ?? '')) index += 1;
  const ch = openTag[index];
  if (isQuote(ch)) return readQuoted(openTag, index)?.value ?? '';
  if (ch !== '{') return '';
  const end = matchPair(openTag, index, '{', '}');
  if (end < 0) return '';
  return stringLiterals(openTag.slice(index + 1, end)).join(' ');
}

function hasClassToken(className: string, token: string): boolean {
  return className.split(/\s+/).includes(token);
}

function tagNameAt(source: string, start: number): string {
  let index = start + 1;
  if (source[index] === '/') index += 1;
  if (source[index] === '>') return '';
  let name = '';
  while (isNameChar(source[index])) {
    name += source[index] ?? '';
    index += 1;
  }
  return name;
}

function enclosingClassName(source: string, index: number): string {
  const stack: { name: string; className: string }[] = [];
  scanCode(source, (cursor) => {
    if (cursor >= index) return source.length;
    if (source[cursor] !== '<' || isIdentChar(source[cursor - 1])) return cursor;
    const next = source[cursor + 1];
    if (next === '/') {
      const openEnd = openingTagEnd(source, cursor);
      if (openEnd < 0 || openEnd >= index) return cursor;
      const name = tagNameAt(source, cursor);
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        const top = stack.pop();
        if (top?.name === name) break;
      }
      return openEnd + 1;
    }
    if (next !== '>' && !isNameChar(next)) return cursor;
    const openEnd = openingTagEnd(source, cursor);
    if (openEnd < 0) return cursor;
    if (openEnd >= index) return cursor;
    if (!isSelfClosing(source, cursor, openEnd)) {
      stack.push({
        name: tagNameAt(source, cursor),
        className: classText(source.slice(cursor, openEnd + 1)),
      });
    }
    return openEnd + 1;
  });
  return stack[stack.length - 1]?.className ?? '';
}

function isFileInput(fragment: string): boolean {
  return /(?:^|[^\w$])type\s*=\s*(?:["']file["']|\{\s*["']file["']\s*\})/.test(fragment);
}

function localComponents(source: string): Map<string, string> {
  const components = new Map<string, string>();
  const pattern = /\bfunction\s+([A-Z][A-Za-z0-9]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const at = match.index;
    if (name === undefined || at === undefined) continue;
    const paren = at + match[0].length - 1;
    const parenEnd = matchPair(source, paren, '(', ')');
    if (parenEnd < 0) continue;
    let bodyAt = parenEnd + 1;
    while (/\s/.test(source[bodyAt] ?? '')) bodyAt += 1;
    if (source[bodyAt] !== '{') continue;
    const bodyEnd = matchPair(source, bodyAt, '{', '}');
    if (bodyEnd < 0) continue;
    components.set(name, source.slice(bodyAt + 1, bodyEnd));
  }
  return components;
}

function referencedUploadNames(expr: string, components: ReadonlyMap<string, string>, seen: Set<string>): string[] {
  const found: string[] = [];
  for (const [name, body] of components) {
    if (seen.has(name) || findOpenTags(expr, name).length === 0) continue;
    seen.add(name);
    if (isFileInput(body)) found.push(name);
    found.push(...referencedUploadNames(body, components, seen));
  }
  return found;
}

function uploadContainerHasFlexWrap(source: string, form: ElementSpan): boolean {
  if (hasClassToken(classText(form.text), 'flex-wrap')) return true;
  return hasClassToken(enclosingClassName(source, form.start), 'flex-wrap');
}

function uploadProblems(source: string): string[] {
  const forms = findElements(source, 'form').filter((form) => isFileInput(form.body) || isFileInput(form.text));
  const ranges = attributeRanges(source, 'actions');
  const components = localComponents(source);
  const problems: string[] = [];
  if (forms.length === 0) problems.push('缺少含 type="file" 的上传 form');
  for (const form of forms) {
    const insideActions = ranges.some((range) => form.start > range.start && form.start < range.end);
    if (insideActions) problems.push(`第 ${form.line} 行含 type="file" 的 form 位于 actions= 属性表达式内`);
    if (!uploadContainerHasFlexWrap(source, form)) problems.push(`第 ${form.line} 行上传 form 的容器 className 不含 flex-wrap`);
  }
  const flagged = new Set<string>();
  for (const range of ranges) {
    const expr = source.slice(range.start, range.end + 1);
    for (const name of referencedUploadNames(expr, components, new Set())) {
      if (flagged.has(name)) continue;
      flagged.add(name);
      problems.push(`actions= 渲染了仍含文件上传的 ${name}`);
    }
  }
  return problems;
}

function isCompactDensity(openTag: string): boolean {
  return /\bdensity\s*=\s*(?:["']compact["']|\{\s*["']compact["']\s*\})/.test(openTag);
}

function hasSizeSm(openTag: string): boolean {
  return /\bsize\s*=\s*(?:["']sm["']|\{\s*["']sm["']\s*\})/.test(openTag);
}

function inputsFromRegion(body: string, components: ReadonlyMap<string, string>, seen: Set<string>, depth: number): string[] {
  const direct = findOpenTags(body, 'Input').map((tag) => tag.text);
  if (depth <= 0) return direct;
  const nested: string[] = [];
  for (const [name, inner] of components) {
    if (seen.has(name) || findOpenTags(body, name).length === 0) continue;
    seen.add(name);
    nested.push(...inputsFromRegion(inner, components, seen, depth - 1));
  }
  return [...direct, ...nested];
}

function compactInputProblems(file: string, source: string): string[] {
  const tables = findElements(source, 'Table').filter((table) => isCompactDensity(table.text));
  if (tables.length === 0) return [];
  const components = localComponents(source);
  const inputs = [...new Set(tables.flatMap((table) => inputsFromRegion(table.body, components, new Set(), 4)))];
  if (inputs.length === 0) return [`${file} 的 density="compact" 表格内没有 Input`];
  return inputs.filter((text) => !hasSizeSm(text)).map((text) => `${file} 紧凑表 Input 缺少 size="sm"：${oneLine(text)}`);
}

describe('q07 exam config', () => {
  it('上传表单不在 actions 属性里，容器 className 含 flex-wrap', () => {
    expect(uploadProblems(readSource(MANAGE))).toEqual([]);
  });

  it('紧凑表内的 Input 带 size="sm"，或两张表都不再 compact', () => {
    const files = [SCORE, POOL].map((file) => ({ file, source: readSource(file) }));
    const compact = files.filter((item) => findElements(item.source, 'Table').some((table) => isCompactDensity(table.text)));
    if (compact.length === 0) {
      expect(compact).toEqual([]);
      return;
    }
    expect(compact.flatMap((item) => compactInputProblems(item.file, item.source))).toEqual([]);
  });

  it('门禁零违规', () => {
    expectGateClean([MANAGE, SCORE, POOL]);
  });
});
