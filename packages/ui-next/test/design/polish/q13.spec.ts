// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const PAGE = 'src/pages/rankboard/admin.tsx';

// 操作列的 w-32 是 M18 should，行为规格只改排名列和奖项 key 列。
const WIDTH_EXCEPTION_HEADER = '操作';

type Quote = '"' | "'" | '`';

interface TagBlock {
  line: number;
  open: string;
  inner: string;
}

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

function matchParen(source: string, openIndex: number): number {
  if (source[openIndex] !== '(') return -1;
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
    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
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

function stringLiterals(source: string): string[] {
  const values: string[] = [];
  let index = 0;
  while (index < source.length) {
    if (!isQuote(source[index])) {
      index += 1;
      continue;
    }
    const quote = source[index];
    if (!isQuote(quote)) break;
    let value = '';
    let cursor = index + 1;
    let closed = false;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === '\\') {
        value += source[cursor + 1] ?? '';
        cursor += 2;
        continue;
      }
      if (quote === '`' && char === '$' && source[cursor + 1] === '{') {
        const nested = matchBrace(source, cursor + 1);
        if (nested < 0) return values;
        value += source.slice(cursor, nested + 1);
        cursor = nested + 1;
        continue;
      }
      if (char === quote) {
        closed = true;
        cursor += 1;
        break;
      }
      value += char ?? '';
      cursor += 1;
    }
    if (!closed) break;
    values.push(value);
    index = cursor;
  }
  return values;
}

function classTokens(openTag: string): string[] {
  const at = openTag.indexOf('className=');
  if (at < 0) return [];
  const body = readAttributeBody(openTag, at + 'className='.length);
  if (body === null) return [];
  const literals = stringLiterals(body);
  const text = literals.length > 0 ? literals.join(' ') : body;
  return text.split(/\s+/).filter((token) => token.length > 0);
}

function utility(token: string): string {
  return token.split(':').pop() ?? token;
}

function blocks(source: string, tag: string): TagBlock[] {
  const found = findOpenTags(source, tag);
  const result: TagBlock[] = [];
  let from = 0;
  for (const item of found) {
    const start = source.indexOf(item.text, from);
    if (start < 0) continue;
    const after = start + item.text.length;
    const closeAt = item.text.endsWith('/>') ? -1 : source.indexOf(`</${tag}>`, after);
    const inner = closeAt < 0 ? '' : source.slice(after, closeAt);
    from = closeAt < 0 ? after : closeAt + tag.length + 3;
    result.push({ line: item.line, open: item.text, inner });
  }
  return result;
}

function plainText(inner: string): string {
  return inner.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

function columnBlocks(source: string): TagBlock[] {
  return [...blocks(source, 'TableHead'), ...blocks(source, 'TableCell')];
}

function narrowColumnProblems(source: string): string[] {
  const problems: string[] = [];
  for (const column of columnBlocks(source)) {
    const tokens = classTokens(column.open);
    const text = plainText(column.inner);
    for (const token of tokens) {
      const name = utility(token);
      if (name === 'w-14') {
        problems.push(`${column.line}: 表格列仍使用 ${token}（${text || column.open}）`);
      }
      if (name === 'w-32' && text !== WIDTH_EXCEPTION_HEADER) {
        problems.push(`${column.line}: 表格列仍使用 ${token}（${text || column.open}）`);
      }
    }
  }
  return problems;
}

function headers(source: string, label: string): TagBlock[] {
  return blocks(source, 'TableHead').filter((head) => plainText(head.inner) === label);
}

function rankCells(source: string): TagBlock[] {
  return blocks(source, 'TableCell').filter((cell) => cell.inner.includes('r.rank'));
}

function keyCells(source: string): TagBlock[] {
  return blocks(source, 'TableCell').filter((cell) => (
    cell.inner.includes('{t.key}') && !cell.inner.includes('AwardTypeName')
  ));
}

function openTagsWithin(source: string): string[] {
  const tags = ['TableCell', 'span', 'p', 'div', 'code'];
  return tags.flatMap((tag) => findOpenTags(source, tag).map((item) => item.text));
}

function hasToken(openTag: string, token: string): boolean {
  return classTokens(openTag).includes(token);
}

function bindsKeyTitle(openTag: string): boolean {
  return /\btitle\s*=\s*\{\s*(?:t\.)?key\s*\}/.test(openTag);
}

function keyContentProblems(source: string): string[] {
  const cells = keyCells(source);
  if (cells.length !== 1) return [`奖项 key 单元格应恰好 1 个，实际 ${cells.length} 个`];
  const cell = cells[0];
  if (cell === undefined) return ['奖项 key 单元格缺失'];
  const region = `${cell.open}${cell.inner}`;
  const carrier = openTagsWithin(region).find((tag) => (
    hasToken(tag, 'block') && hasToken(tag, 'truncate') && bindsKeyTitle(tag)
  ));
  if (carrier === undefined) {
    return ['key 单元格内容缺少同时带 block、truncate 和 title={key} 的元素'];
  }
  return [];
}

function rankContentProblems(source: string): string[] {
  const cells = rankCells(source);
  if (cells.length !== 1) return [`排名单元格应恰好 1 个，实际 ${cells.length} 个`];
  const cell = cells[0];
  if (cell === undefined) return ['排名单元格缺失'];
  const region = `${cell.open}${cell.inner}`;
  const carrier = openTagsWithin(region).find((tag) => hasToken(tag, 'tabular') && hasToken(tag, 'truncate'));
  if (carrier === undefined) return ['排名单元格内容缺少同时带 tabular 和 truncate 的元素'];
  return [];
}

function headerWidthProblems(source: string, label: string, width: string): string[] {
  const heads = headers(source, label);
  if (heads.length !== 1) return [`「${label}」列表头应恰好 1 个，实际 ${heads.length} 个`];
  const head = heads[0];
  if (head === undefined) return [`「${label}」列表头缺失`];
  if (!classTokens(head.open).includes(width)) {
    return [`${head.line}: 「${label}」列宽不是 ${width}`];
  }
  return [];
}

function attributeExpression(openTag: string, name: string): string | null {
  const key = `${name}=`;
  const at = openTag.indexOf(key);
  if (at < 0) return null;
  return readAttributeBody(openTag, at + key.length);
}

function localFunctionBody(source: string, name: string): string | null {
  const start = source.search(new RegExp(`(?:async\\s+function|function)\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=`));
  if (start < 0) return null;
  const brace = source.indexOf('{', start);
  if (brace < 0) return null;
  const end = matchBrace(source, brace);
  if (end < 0) return null;
  return source.slice(brace, end + 1);
}

function calleeNames(expression: string): string[] {
  const skip = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'confirmDialog', 'updateAward', 'nextCoverIndex', 'filter',
  ]);
  const names: string[] = [];
  for (const match of expression.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (name !== undefined && !skip.has(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

function handlerSource(source: string, onClick: string): string {
  let combined = onClick;
  for (const name of calleeNames(onClick)) {
    const body = localFunctionBody(source, name);
    if (body !== null) combined += `\n${body}`;
  }
  return combined;
}

function confirmCalls(handler: string): string[] {
  const calls: string[] = [];
  for (const match of handler.matchAll(/confirmDialog\s*\(/g)) {
    const start = match.index ?? 0;
    const open = start + match[0].length - 1;
    const end = matchParen(handler, open);
    if (end < 0) continue;
    calls.push(handler.slice(start, end + 1));
  }
  return calls;
}

function returnPrecedesImage(handler: string, index: number): boolean {
  const after = handler.slice(index);
  const ret = after.search(/\breturn\b/);
  const image = after.search(/imageUrls\b/);
  return ret >= 0 && image > ret;
}

function ifBodyDeletes(handler: string, ifIndex: number): boolean {
  const paren = handler.indexOf('(', ifIndex);
  if (paren < 0) return false;
  const close = matchParen(handler, paren);
  if (close < 0) return false;
  let cursor = close + 1;
  while (handler[cursor] === ' ' || handler[cursor] === '\n' || handler[cursor] === '\r') cursor += 1;
  if (handler[cursor] !== '{') return false;
  const end = matchBrace(handler, cursor);
  if (end < 0) return false;
  const body = handler.slice(cursor, end + 1);
  return /imageUrls\b/.test(body) && /coverIndex\b/.test(body);
}

function declinesBeforeDelete(handler: string): boolean {
  const negatedAwait = handler.search(/if\s*\(\s*!(?:\(\s*)?await\s+confirmDialog\b/);
  if (negatedAwait >= 0 && returnPrecedesImage(handler, negatedAwait)) return true;
  const negatedName = handler.search(/await\s+confirmDialog\b[\s\S]+?if\s*\(\s*!\s*[A-Za-z_$][\w$]*\s*\)/);
  if (negatedName >= 0 && returnPrecedesImage(handler, negatedName)) return true;
  const positiveCall = handler.search(/if\s*\(\s*(?:await\s+)?confirmDialog\s*\(/);
  if (positiveCall >= 0 && ifBodyDeletes(handler, positiveCall)) return true;
  const positiveName = /await\s+confirmDialog\b[\s\S]+?if\s*\(\s*[A-Za-z_$][\w$]*\s*\)/.exec(handler);
  if (positiveName !== null && positiveName.index !== undefined) {
    const ifAt = handler.indexOf('if', positiveName.index);
    if (ifAt >= 0 && ifBodyDeletes(handler, ifAt)) return true;
  }
  return false;
}

function photoDeleteProblems(source: string): string[] {
  const buttons = blocks(source, 'Button').filter((button) => (
    button.open.includes('danger-soft') && plainText(button.inner) === '删除'
  ));
  if (buttons.length !== 1) return [`删除照片按钮应恰好 1 个，实际 ${buttons.length} 个`];
  const button = buttons[0];
  if (button === undefined) return ['删除照片按钮缺失'];
  const onClick = attributeExpression(button.open, 'onClick');
  if (onClick === null) return [`${button.line}: 删除照片按钮没有 onClick`];
  const handler = handlerSource(source, onClick);
  const problems: string[] = [];
  const calls = confirmCalls(handler);
  if (calls.length === 0) {
    problems.push(`${button.line}: 删除照片的 onClick 没有调用 confirmDialog`);
  }
  const call = calls[0] ?? '';
  if (call !== '' && !/confirmLabel\s*:\s*(['"])删除\1/.test(call)) {
    problems.push('confirmDialog 没有传入 confirmLabel: \'删除\'');
  }
  if (call !== '' && !/title\s*:\s*(['"])删除这张照片？\1/.test(call)) {
    problems.push('confirmDialog 没有传入 title: \'删除这张照片？\'');
  }
  if (call !== '' && !/\bdestructive\s*:\s*true\b/.test(call)) {
    problems.push('confirmDialog 没有传入 destructive: true');
  }
  const confirmAt = handler.search(/confirmDialog\s*\(/);
  const imageAt = handler.search(/imageUrls\b/);
  const coverAt = handler.search(/coverIndex\b/);
  if (confirmAt >= 0 && (imageAt < confirmAt || coverAt < confirmAt)) {
    problems.push('confirmDialog 出现在删除 imageUrls / coverIndex 之后');
  }
  if (confirmAt >= 0 && (imageAt < 0 || coverAt < 0)) {
    problems.push('确认之后没有保留原来的 imageUrls / coverIndex 删除');
  }
  if (confirmAt >= 0 && !declinesBeforeDelete(handler)) {
    problems.push('取消确认时仍会执行删除');
  }
  return problems;
}

describe('q13 rankboard admin key and rank columns, photo delete confirm', () => {
  it('表格列不含 w-14，且除操作列外不含 w-32', () => {
    expect(narrowColumnProblems(readSource(PAGE))).toEqual([]);
  });

  it('排名列宽为 w-20，单元格内容同时有 tabular 和 truncate', () => {
    const source = readSource(PAGE);
    expect(headerWidthProblems(source, '排名', 'w-20')).toEqual([]);
    expect(rankContentProblems(source)).toEqual([]);
  });

  it('奖项 key 列宽为 w-48，单元格内容 block truncate 且 title 绑定 key', () => {
    const source = readSource(PAGE);
    expect(headerWidthProblems(source, 'key', 'w-48')).toEqual([]);
    expect(keyContentProblems(source)).toEqual([]);
  });

  it('删除照片先 confirmDialog，确认后才改 imageUrls 和 coverIndex', () => {
    expect(photoDeleteProblems(readSource(PAGE))).toEqual([]);
  });

  it('荣誉榜管理页门禁零违规', () => {
    expectGateClean([PAGE]);
  });
});
