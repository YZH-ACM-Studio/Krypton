// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const PAGE = 'src/pages/contest-teams.tsx';

type Quote = '"' | "'" | '`';

function isQuote(char: string | undefined): char is Quote {
  return char === '"' || char === "'" || char === '`';
}

function matchBrace(source: string, openIndex: number): number {
  if (source[openIndex] !== '{') return -1;
  let depth = 0;
  let quote: Quote | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (quote === '`' && char === '$' && source[index + 1] === '{') {
        const nested = matchBrace(source, index + 1);
        if (nested < 0) return -1;
        index = nested;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (isQuote(char)) {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readQuoted(source: string, index: number): { value: string; next: number } | null {
  const quote = source[index];
  if (!isQuote(quote)) return null;
  let value = '';
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      value += source[cursor + 1] ?? '';
      cursor += 2;
      continue;
    }
    if (quote === '`' && char === '$' && source[cursor + 1] === '{') {
      const nested = matchBrace(source, cursor + 1);
      if (nested < 0) return null;
      value += source.slice(cursor, nested + 1);
      cursor = nested + 1;
      continue;
    }
    if (char === quote) return { value, next: cursor + 1 };
    value += char ?? '';
    cursor += 1;
  }
  return null;
}

function stringLiterals(source: string): string[] {
  const values: string[] = [];
  let index = 0;
  while (index < source.length) {
    if (!isQuote(source[index])) {
      index += 1;
      continue;
    }
    const quoted = readQuoted(source, index);
    if (quoted === null) break;
    values.push(quoted.value);
    index = quoted.next;
  }
  return values;
}

function readAttributeBody(source: string, start: number): string | null {
  const quote = source[start];
  if (quote === '"' || quote === "'") {
    const end = source.indexOf(quote, start + 1);
    if (end < 0) return null;
    return source.slice(start, end + 1);
  }
  if (quote === '{') {
    const end = matchBrace(source, start);
    if (end < 0) return null;
    return source.slice(start, end + 1);
  }
  return null;
}

function toneAttributeBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const match of source.matchAll(/\btone\s*=/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const body = readAttributeBody(source, start);
    if (body !== null) bodies.push(body);
  }
  return bodies;
}

function isBrandTone(body: string): boolean {
  return stringLiterals(body).includes('brand');
}

function classNameStrings(source: string): string[] {
  const values: string[] = [];
  let search = 0;
  while (search < source.length) {
    const at = source.indexOf('className=', search);
    if (at < 0) break;
    const cursor = at + 'className='.length;
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, cursor + 1);
      if (end < 0) break;
      values.push(source.slice(cursor + 1, end));
      search = end + 1;
      continue;
    }
    if (quote === '{') {
      const end = matchBrace(source, cursor);
      if (end < 0) break;
      values.push(...stringLiterals(source.slice(cursor + 1, end)));
      search = end + 1;
      continue;
    }
    search = cursor + 1;
  }
  return values;
}

function attributeText(tag: string, name: string): string | null {
  const key = `${name}=`;
  const at = tag.indexOf(key);
  if (at < 0) return null;
  const body = readAttributeBody(tag, at + key.length);
  if (body === null) return null;
  if (body.startsWith('{') && body.endsWith('}')) return body.slice(1, -1);
  return stringLiterals(body)[0] ?? null;
}

interface ElementBlock {
  open: string;
  inner: string;
}

function elementBlocks(source: string, tag: string): ElementBlock[] {
  const close = `</${tag}>`;
  const blocks: ElementBlock[] = [];
  let from = 0;
  for (const open of findOpenTags(source, tag)) {
    const at = source.indexOf(open.text, from);
    if (at < 0) continue;
    const after = at + open.text.length;
    if (/\/\s*>$/.test(open.text)) {
      blocks.push({ open: open.text, inner: '' });
      from = after;
      continue;
    }
    const end = source.indexOf(close, after);
    blocks.push({ open: open.text, inner: end < 0 ? '' : source.slice(after, end) });
    from = end < 0 ? after : end + close.length;
  }
  return blocks;
}

describe('q06 contest teams freeze tone, role badges, nested boxes', () => {
  it('源码不含 tone="brand"，tone 值也不含 brand 字面量', () => {
    const source = readSource(PAGE);
    const problems = [
      ...(source.includes('tone="brand"') ? ['tone="brand"'] : []),
      ...toneAttributeBodies(source).filter(isBrandTone),
    ];
    expect(problems).toEqual([]);
  });

  it('「已开赛」所在 Badge 开标签含 tone="warning" 且不含 variant="solid"', () => {
    const started = elementBlocks(readSource(PAGE), 'Badge').filter((block) => `${block.open}${block.inner}`.includes('已开赛'));
    expect(started.map((block) => block.open)).not.toEqual([]);
    const problems = started
      .filter((block) => !block.open.includes('tone="warning"') || block.open.includes('variant="solid"'))
      .map((block) => block.open.replaceAll(/\s+/g, ' '));
    expect(problems).toEqual([]);
  });

  it('crown 图标开标签 className 不含 warning', () => {
    const crowns = findOpenTags(readSource(PAGE), 'Crown');
    expect(crowns.length).toBeGreaterThan(0);
    const warned = crowns
      .map((tag) => attributeText(tag.text, 'className'))
      .filter((className): className is string => className !== null && className.includes('warning'));
    expect(warned).toEqual([]);
  });

  it('同一 className 字符串中 bg-surface-sunken 不与 border 同时出现', () => {
    const mixed = classNameStrings(readSource(PAGE)).filter((value) => value.includes('bg-surface-sunken') && value.includes('border'));
    expect(mixed).toEqual([]);
  });

  it('门禁零违规', () => {
    expectGateClean([PAGE]);
  });
});
