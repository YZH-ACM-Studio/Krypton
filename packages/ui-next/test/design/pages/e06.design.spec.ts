// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/cn';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const FILE = 'src/pages/exam-classroom.tsx';

// legacy-intents T01–T04 没有源文件为本文件的条目。
// 未设置朝向仍显示「未」，悬停标题仍是「业务朝向：未设置」；只改盒子尺寸并去掉边框。

const FORBIDDEN_SOURCE = ['max-h-96', 'dvh', '100vh', 'h-screen', 'max-w-none'] as const;
const SELECTION_RING = ['ring-2', 'ring-brand', 'ring-offset-1', 'ring-offset-surface'] as const;
const ABNORMAL_STATUSES = ['conflict', 'identity-change', 'unknown'] as const;

interface SeatFlags {
  selected: boolean;
  operationallySelected: boolean;
  recentlyResponded: boolean;
  enabled: boolean;
}

function stripComments(source: string): string {
  let out = '';
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const char = source[cursor] ?? '';
    const next = source[cursor + 1] ?? '';
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

function readBalanced(source: string, open: number, openChar: string, closeChar: string): string {
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    const char = source[cursor] ?? '';
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

function findTopLevel(source: string, op: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote !== null) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      continue;
    }
    if (depth === 0 && source.startsWith(op, index)) return index;
  }
  return -1;
}

function splitArgs(body: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? '';
    if (quote !== null) {
      current += char;
      if (char === '\\') {
        current += body[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;
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

function stringLiteral(expr: string): string | null {
  const match = /^(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)$/.exec(expr.trim());
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function constString(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*const ${escaped}\\s*=\\s*(['"\`])([^'"\`\\n]*)\\1`).exec(source);
  return match?.[2] ?? null;
}

function objectBody(source: string, constName: string): string {
  const start = source.indexOf(`const ${constName}`);
  if (start < 0) throw new TypeError(`缺少 ${constName}`);
  const equals = source.indexOf('=', start);
  if (equals < 0) throw new TypeError(`${constName} 没有初始值`);
  const brace = source.indexOf('{', equals);
  if (brace < 0) throw new TypeError(`${constName} 不是对象`);
  const body = readBalanced(source, brace, '{', '}');
  if (!body) throw new TypeError(`${constName} 对象没有结束`);
  return body;
}

function objectField(body: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[\\n,{])\\s*(?:'${escaped}'|"${escaped}"|${escaped})\\s*:\\s*`).exec(body);
  if (match === null || match.index === undefined) throw new TypeError(`对象缺少 ${key}`);
  const rest = body.slice(match.index + match[0].length).trim();
  if (rest.startsWith('{')) {
    const field = readBalanced(rest, 0, '{', '}');
    if (!field) throw new TypeError(`${key} 字段没有结束`);
    return field;
  }
  if (rest.startsWith("'") || rest.startsWith('"') || rest.startsWith('`')) {
    const end = skipString(rest, 0);
    return rest.slice(0, end + 1);
  }
  throw new TypeError(`${key} 字段不是对象或字符串`);
}

function classTokens(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function hasToken(value: string, token: string): boolean {
  return classTokens(value).includes(token);
}

function cnBodyAfter(source: string, needle: string): string {
  const at = source.indexOf(needle);
  if (at < 0) throw new TypeError(`源码缺少 ${needle}`);
  const cnAt = source.indexOf('cn(', at);
  if (cnAt < 0) throw new TypeError(`${needle} 之后没有 cn()`);
  const call = readBalanced(source, cnAt + 2, '(', ')');
  if (!call) throw new TypeError('cn() 没有结束');
  return call.slice(1, -1);
}

function literalClasses(body: string): string[] {
  const values: string[] = [];
  for (const arg of splitArgs(body)) {
    const pattern = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    for (const match of arg.matchAll(pattern)) {
      const text = match[2] ?? '';
      if (!text.includes('${')) values.push(text);
    }
  }
  return values;
}

function evalCondition(expr: string, flags: SeatFlags): boolean {
  const text = expr.trim();
  if (text.startsWith('(') && text.endsWith(')') && findTopLevel(text.slice(1, -1), ')') < 0) {
    const inner = readBalanced(text, 0, '(', ')');
    if (inner === text) return evalCondition(text.slice(1, -1), flags);
  }
  const orAt = findTopLevel(text, '||');
  if (orAt >= 0) return evalCondition(text.slice(0, orAt), flags) || evalCondition(text.slice(orAt + 2), flags);
  const andAt = findTopLevel(text, '&&');
  if (andAt >= 0) return evalCondition(text.slice(0, andAt), flags) && evalCondition(text.slice(andAt + 2), flags);
  if (text.startsWith('!')) return !evalCondition(text.slice(1), flags);
  if (text === 'selected') return flags.selected;
  if (text === 'operationallySelected') return flags.operationallySelected;
  if (text === 'recentlyResponded') return flags.recentlyResponded;
  if (text === 'view.operational.enabled') return flags.enabled;
  throw new TypeError(`无法判断座位 class 条件：${text}`);
}

function classValue(source: string, expr: string): string | null {
  const literal = stringLiteral(expr);
  if (literal !== null) return literal;
  const name = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(name)) return constString(source, name);
  return null;
}

function evalClassArg(source: string, arg: string, flags: SeatFlags): string {
  const text = arg.trim();
  const literal = stringLiteral(text);
  if (literal !== null) return literal;
  if (text === 'STATUS_STYLES[view.status]') {
    const style = stringLiteral(objectField(objectBody(source, 'STATUS_STYLES'), 'offline'));
    if (style === null) throw new TypeError('STATUS_STYLES.offline 不是字符串');
    return style;
  }
  const andAt = findTopLevel(text, '&&');
  if (andAt >= 0) {
    if (!evalCondition(text.slice(0, andAt), flags)) return '';
    const value = classValue(source, text.slice(andAt + 2));
    if (value === null) throw new TypeError(`座位 class 取值无法解析：${text.slice(andAt + 2).trim()}`);
    return value;
  }
  const question = findTopLevel(text, '?');
  if (question >= 0) {
    const rest = text.slice(question + 1);
    const colon = findTopLevel(rest, ':');
    if (colon < 0) throw new TypeError(`座位 class 三元表达式缺少分支：${text}`);
    const chosen = evalCondition(text.slice(0, question), flags) ? rest.slice(0, colon) : rest.slice(colon + 1);
    const value = classValue(source, chosen);
    if (value === null) throw new TypeError(`座位 class 取值无法解析：${chosen.trim()}`);
    return value;
  }
  const named = classValue(source, text);
  if (named !== null) return named;
  throw new TypeError(`座位 class 参数无法解析：${text}`);
}

function seatClass(source: string, flags: SeatFlags): string {
  const body = cnBodyAfter(source, 'data-seat-id={');
  const classes = splitArgs(body)
    .map((arg) => evalClassArg(source, arg, flags))
    .filter((value) => value.length > 0);
  return cn(...classes);
}

function attributeExpression(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=`).exec(tag);
  if (match === null || match.index === undefined) return '';
  let cursor = match.index + match[0].length;
  while (tag[cursor] === ' ' || tag[cursor] === '\n' || tag[cursor] === '\t') cursor += 1;
  const char = tag[cursor] ?? '';
  if (char === '"' || char === "'") {
    const end = skipString(tag, cursor);
    return tag.slice(cursor, end + 1);
  }
  if (char === '{') return readBalanced(tag, cursor, '{', '}');
  return '';
}

function finalClassName(source: string, expression: string): string {
  const text = expression.trim();
  const literal = stringLiteral(text);
  if (literal !== null) return literal;
  if (text.startsWith('{') && text.endsWith('}')) return finalClassName(source, text.slice(1, -1));
  if (text.startsWith('cn(')) {
    const call = readBalanced(text, 2, '(', ')');
    return cn(...literalClasses(call.slice(1, -1)));
  }
  return classValue(source, text) ?? '';
}

function openingTagAt(source: string, start: number): string {
  let quote: string | null = null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote !== null) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
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
      depth -= 1;
      continue;
    }
    if (char === '>' && depth === 0) return source.slice(start, index + 1);
  }
  return '';
}

function tagAround(source: string, needle: string): string {
  const at = source.indexOf(needle);
  if (at < 0) return '';
  const start = source.lastIndexOf('<', at);
  if (start < 0) return '';
  return openingTagAt(source, start);
}

function expectSelectionClass(className: string, label: string): void {
  const tokens = classTokens(className);
  for (const token of SELECTION_RING) {
    expect(tokens, `${label} 缺少 ${token}：${className}`).toContain(token);
  }
  expect(hasToken(className, 'outline-none'), `${label} 仍含 outline-none：${className}`).toBe(false);
  expect(className.includes('violet'), `${label} 仍含 violet：${className}`).toBe(false);
}

describe('e06 exam classroom', () => {
  it('门禁零违规', () => {
    expectGateClean([FILE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([FILE]);
  });

  it('页面结构 src/pages/exam-classroom.tsx', () => {
    expectPageStructure(FILE, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('包在 AdminPage 中并保持 hideSidebar，教室名从 h1 移到 title', () => {
    const src = readSource(FILE);
    const pages = findOpenTags(src, 'AdminPage');
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((tag) => /\bhideSidebar\b/.test(tag.text))).toBe(true);
    expect(pages.some((tag) => /title=\{\s*state\.classroom\.name\s*\}/.test(tag.text))).toBe(true);
    expect(findOpenTags(src, 'h1').length).toBe(0);
    expect(findOpenTags(src, 'Page').length).toBe(0);
    expect(findOpenTags(src, 'PageHeader').length).toBe(0);
    expect(findOpenTags(src, 'Workspace').length).toBe(0);
  });

  it('源码不含 max-h-96、dvh、100vh、h-screen、max-w-none，也不写死高度上限', () => {
    const src = readSource(FILE);
    for (const token of FORBIDDEN_SOURCE) {
      expect(src.includes(token), token).toBe(false);
    }
    expect(src).not.toMatch(/(?<![\w-])max-h-/);
    expect(src).not.toMatch(/(?<![\w-])h-\[[^\]]*\]/);
  });

  it('座位画布经 cn() 合并后只保留横向滚动，且不拦截页面纵向滚轮', () => {
    const merged = cn(...literalClasses(cnBodyAfter(stripComments(readSource(FILE)), '教室实体座位布局')));
    expect(hasToken(merged, 'overflow-x-auto'), merged).toBe(true);
    expect(hasToken(merged, 'overflow-auto'), merged).toBe(false);
    expect(hasToken(merged, 'overflow-y-auto'), merged).toBe(false);
    expect(merged).not.toMatch(/(?<![\w-])max-h-/);
    expect(merged).not.toMatch(/(?<![\w-])h-\[[^\]]*\]/);
    for (const token of ['overscroll-contain', 'overscroll-none', 'overscroll-y-contain', 'overscroll-y-none'] as const) {
      expect(hasToken(merged, token), merged).toBe(false);
    }
  });

  it('批量选中与单击选中的座位 class 经 cn() 合并后含 ring-brand，不含 outline-none 与 violet', () => {
    const src = stripComments(readSource(FILE));
    const enabled = { recentlyResponded: false, enabled: true };
    expectSelectionClass(seatClass(src, { ...enabled, selected: false, operationallySelected: true }), '批量选中');
    expectSelectionClass(seatClass(src, { ...enabled, selected: true, operationallySelected: false }), '单击选中');
    expectSelectionClass(seatClass(src, { ...enabled, selected: true, operationallySelected: true }), '同时选中');
  });

  it('源码不含 violet', () => {
    expect(readSource(FILE).includes('violet')).toBe(false);
  });

  it('批量运行配置编辑器使用 bg-surface-sunken 且无边框', () => {
    const src = stripComments(readSource(FILE));
    const tag = findOpenTags(src, 'section').find((item) => item.text.includes('座位运行配置编辑器'));
    expect(tag, '座位运行配置编辑器').toBeDefined();
    const className = finalClassName(src, attributeExpression(tag?.text ?? '', 'className'));
    expect(className.length, className).toBeGreaterThan(0);
    expect(hasToken(className, 'bg-surface-sunken'), className).toBe(true);
    expect(classTokens(className).some((token) => token === 'border' || token.startsWith('border-')), className).toBe(false);
    expect(className.includes('violet'), className).toBe(false);
  });

  it('所有朝向角标（含未设置）为 size-4、text-2xs、leading-none、居中且无边框', () => {
    const src = stripComments(readSource(FILE));
    const tag = tagAround(src, '业务朝向：');
    expect(tag.includes('业务朝向：'), tag).toBe(true);
    const className = cn(finalClassName(src, attributeExpression(tag, 'className')));
    const tokens = classTokens(className);
    expect(className.length, className).toBeGreaterThan(0);
    expect(tokens, className).toContain('size-4');
    expect(tokens, className).toContain('text-2xs');
    expect(tokens, className).toContain('leading-none');
    expect(tokens, className).toContain('items-center');
    expect(tokens, className).toContain('justify-center');
    expect(tokens.some((token) => token === 'border' || token.startsWith('border-')), className).toBe(false);
  });

  it('机位在线状态使用 StatusDot', () => {
    const src = readSource(FILE);
    expect(src).toMatch(/import\s*\{[^}]*\bStatusDot\b[^}]*\}\s*from\s*['"]@\/components\/ui\/display['"]/);
    expect(findOpenTags(src, 'StatusDot').length).toBeGreaterThan(0);
    const dots = objectBody(src, 'STATUS_DOT');
    const online = objectField(dots, 'online');
    expect(/tone\s*:\s*['"]success['"]/.test(online)).toBe(true);
    expect(/pulse\s*:\s*true\b/.test(online)).toBe(true);
    const offline = objectField(dots, 'offline');
    expect(/tone\s*:\s*['"]neutral['"]/.test(offline)).toBe(true);
    for (const status of ABNORMAL_STATUSES) {
      expect(/tone\s*:\s*['"]danger['"]/.test(objectField(dots, status)), status).toBe(true);
    }
  });
});
