// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from '../../../src/lib/cn';
import { expectGateClean, readSource } from '../helpers.ts';

const ADMIN = 'src/pages/admin.tsx';
const DROPBOX = 'src/pages/admin-dropbox.tsx';
const STATS = 'src/pages/admin-stats.tsx';
const LANE_FILES = [ADMIN, DROPBOX, STATS] as const;

const WIDTH_COLUMNS = ['w-32', 'w-40', 'w-48'] as const;

type Quote = '"' | "'" | '`';

interface Markup {
  name: string;
  open: string;
  start: number;
  openEnd: number;
  end: number;
}

function isQuote(char: string | undefined): char is Quote {
  return char === '"' || char === "'" || char === '`';
}

function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || !/[\w$]/.test(char);
}

function skipLineComment(source: string, index: number): number {
  const next = source.indexOf('\n', index);
  return next < 0 ? source.length : next;
}

function skipBlockComment(source: string, index: number): number {
  const next = source.indexOf('*/', index + 2);
  return next < 0 ? source.length : next + 1;
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
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
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

function readValue(source: string, start: number): string {
  let index = start;
  while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
  const begin = index;
  const first = source[begin];
  if (first === '{') {
    const end = matchBrace(source, begin);
    return end < 0 ? source.slice(begin).trim() : source.slice(begin, end + 1).trim();
  }
  if (isQuote(first)) {
    let cursor = begin + 1;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === first) return source.slice(begin, cursor + 1);
      cursor += 1;
    }
    return source.slice(begin).trim();
  }
  let quote: Quote | null = null;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  for (let cursor = begin; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote !== null) {
      if (char === '\\') {
        cursor += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '/') {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (isQuote(char)) {
      quote = char;
      continue;
    }
    if (char === '{') brace += 1;
    else if (char === '}') {
      if (brace === 0 && paren === 0 && bracket === 0) return source.slice(begin, cursor).trim();
      brace -= 1;
    } else if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if ((char === ',' || char === ';') && brace === 0 && paren === 0 && bracket === 0) {
      return source.slice(begin, cursor).trim();
    }
  }
  return source.slice(begin).trim();
}

function findOpenTagEnd(source: string, start: number): number {
  let depth = 0;
  let quote: Quote | null = null;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === '\\' && depth > 0) {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (isQuote(char)) {
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

function findClose(source: string, name: string, from: number): number {
  const openNeedle = `<${name}`;
  const closeNeedle = `</${name}`;
  let depth = 1;
  let index = from;
  while (index < source.length && depth > 0) {
    const next = source.indexOf('<', index);
    if (next < 0) return source.length;
    if (source.startsWith(closeNeedle, next) && isTagBoundary(source[next + closeNeedle.length])) {
      const end = source.indexOf('>', next);
      depth -= 1;
      if (depth === 0) return end < 0 ? source.length : end + 1;
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith(openNeedle, next) && isTagBoundary(source[next + openNeedle.length])) {
      const openEnd = findOpenTagEnd(source, next);
      if (openEnd < 0) return source.length;
      if (!/\/\s*>$/.test(source.slice(next, openEnd + 1))) depth += 1;
      index = openEnd + 1;
      continue;
    }
    index = next + 1;
  }
  return source.length;
}

function markup(source: string): Markup[] {
  const found: Markup[] = [];
  let quote: Quote | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
      continue;
    }
    if (isQuote(char)) {
      quote = char;
      continue;
    }
    if (char !== '<' || source.startsWith('</', index) || source.startsWith('<!', index)) continue;
    const name = /^<([A-Za-z][\w.]*)/.exec(source.slice(index))?.[1];
    if (!name || !isTagBoundary(source[index + 1 + name.length])) continue;
    const openEnd = findOpenTagEnd(source, index);
    if (openEnd < 0) break;
    const open = source.slice(index, openEnd + 1);
    const selfClosing = /\/\s*>$/.test(open);
    const end = selfClosing ? openEnd + 1 : findClose(source, name, openEnd + 1);
    found.push({ name, open, start: index, openEnd: openEnd + 1, end });
  }
  return found;
}

function contains(item: Markup, index: number): boolean {
  return item.start <= index && index < item.end;
}

function smallest(items: Markup[]): Markup | null {
  return items.reduce<Markup | null>((best, item) => {
    if (best === null || item.end - item.start < best.end - best.start) return item;
    return best;
  }, null);
}

function attributeSource(open: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*`).exec(open);
  if (!match || match.index === undefined) return null;
  const raw = readValue(open, match.index + match[0].length);
  if (raw.startsWith('"') || raw.startsWith("'")) return raw.slice(1, -1);
  return raw;
}

function bindings(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    map.set(name, readValue(source, match.index + match[0].length));
  }
  return map;
}

function stringConstants(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, expression] of bindings(source)) {
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(expression.trim());
    const value = quoted?.[2];
    if (value !== undefined && !value.includes('${')) map.set(name, value);
  }
  return map;
}

function classTokens(open: string, constants: ReadonlyMap<string, string>): Set<string> {
  const raw = attributeSource(open, 'className');
  const tokens = new Set<string>();
  if (raw === null) return tokens;
  const add = (value: string) => {
    for (const token of value.split(/\s+/)) {
      if (token.length > 0) tokens.add(token);
    }
  };
  const expression = raw.startsWith('{') ? raw.slice(1, -1) : raw;
  if (!raw.startsWith('{')) add(raw);
  for (const match of expression.matchAll(/['"`]([^'"`]*)['"`]/g)) add(match[1] ?? '');
  for (const match of expression.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const resolved = constants.get(match[0] ?? '');
    if (resolved !== undefined) add(resolved);
  }
  return tokens;
}

function hasTokens(open: string, constants: ReadonlyMap<string, string>, tokens: readonly string[]): boolean {
  const present = classTokens(open, constants);
  return tokens.every((token) => present.has(token));
}

function expand(text: string, bound: ReadonlyMap<string, string>): string {
  let current = text;
  for (let depth = 0; depth < 5; depth += 1) {
    const next = current.replace(/[A-Za-z_$][\w$]*/g, (name) => bound.get(name) ?? name);
    if (next === current) break;
    current = next;
  }
  return current;
}

function covers(text: string, needle: RegExp, bound: ReadonlyMap<string, string>): boolean {
  const check = (value: string) => new RegExp(needle.source, needle.flags.replaceAll('g', '')).test(value);
  return check(text) || check(expand(text, bound));
}

function carries(text: string, needle: string, bound: ReadonlyMap<string, string>): boolean {
  return text.includes(needle) || expand(text, bound).includes(needle);
}

function offendingLines(source: string, token: string): string[] {
  return source.split('\n').flatMap((line, index) => (
    line.includes(token) ? [`${index + 1}:${line.trim()}`] : []
  ));
}

function objectAt(source: string, index: number): string {
  const objects: string[] = [];
  let quote: Quote | null = null;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote !== null) {
      if (char === '\\') {
        cursor += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '/') {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    if (isQuote(char)) {
      quote = char;
      continue;
    }
    if (char !== '{') continue;
    const end = matchBrace(source, cursor);
    if (end > index && cursor < index) objects.push(source.slice(cursor, end + 1));
  }
  return objects.reduce((best, item) => (item.length < best.length ? item : best), source);
}

function property(objectText: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*:\\s*`).exec(objectText);
  if (!match || match.index === undefined) return null;
  return readValue(objectText, match.index + match[0].length);
}

function statusMetricGrid(source: string): Markup | null {
  const labelAt = source.indexOf('内存使用');
  if (labelAt < 0) return null;
  const constants = stringConstants(source);
  return smallest(markup(source).filter((item) => (
    contains(item, labelAt) && classTokens(item.open, constants).has('grid-cols-2')
  )));
}

function memoryExpressions(source: string): { value: string; hints: string[] } {
  const labelAt = source.indexOf('内存使用');
  const grid = statusMetricGrid(source);
  const hints: string[] = [];
  const object = labelAt < 0 ? '' : objectAt(source, labelAt);
  const objectHint = property(object, 'hint');
  if (objectHint !== null) hints.push(objectHint);
  const stats = grid === null ? [] : markup(source).filter((item) => item.name === 'Stat' && contains(grid, item.start));
  for (const stat of stats) {
    const hint = attributeSource(stat.open, 'hint');
    if (hint !== null) hints.push(hint);
  }
  const direct = stats.find((item) => item.open.includes('内存使用'));
  const directValue = direct === undefined ? null : attributeSource(direct.open, 'value');
  const value = directValue !== null && !directValue.includes('item.value')
    ? directValue
    : (property(object, 'value') ?? directValue ?? '');
  return { value, hints };
}

function modelElement(source: string): Markup | null {
  const bound = bindings(source);
  const constants = stringConstants(source);
  const needle = /cpu\??\.(?:manufacturer|brand)/;
  return smallest(markup(source).filter((item) => (
    hasTokens(item.open, constants, ['block', 'min-w-0', 'truncate'])
    && attributeSource(item.open, 'title') !== null
    && covers(`${item.open}\n${source.slice(item.openEnd, item.end)}`, needle, bound)
  )));
}

function filenameElement(source: string): Markup | null {
  const bound = bindings(source);
  const constants = stringConstants(source);
  const needle = /file\.originalName/;
  return smallest(markup(source).filter((item) => {
    const title = attributeSource(item.open, 'title');
    return hasTokens(item.open, constants, ['block', 'min-w-0', 'truncate'])
      && title !== null
      && covers(title, needle, bound);
  }));
}

function cellContaining(source: string, index: number): Markup | null {
  return smallest(markup(source).filter((item) => item.name === 'TableCell' && contains(item, index)));
}

function fileActionCell(source: string): Markup | null {
  return smallest(markup(source).filter((item) => {
    if (item.name !== 'TableCell') return false;
    const body = source.slice(item.openEnd, item.end);
    return body.includes('下载') && body.includes('删除') && body.includes('file.downloadUrl');
  }));
}

function declaredClass(open: string, constants: ReadonlyMap<string, string>): string {
  return [...classTokens(open, constants)].join(' ');
}

function mergedActionClass(className: string): string {
  // 与 TableActions 根节点同一条 cn：默认 flex-wrap，页面 class 在后面。
  return cn('flex flex-wrap items-center gap-1.5', className.length > 0 ? className : undefined);
}

function serverStatusTable(source: string): Markup | null {
  const head = headByText(source, 'CPU');
  if (head === null) return null;
  return smallest(markup(source).filter((item) => item.name === 'Table' && contains(item, head.start)));
}

function headByText(source: string, text: string): Markup | null {
  return markup(source).find((item) => (
    item.name === 'TableHead' && source.slice(item.openEnd, item.end).replace(/<[^>]*>/g, '').trim() === text
  )) ?? null;
}

function isRow(open: string, constants: ReadonlyMap<string, string>): boolean {
  const tokens = classTokens(open, constants);
  const row = tokens.has('flex') || tokens.has('inline-flex');
  return row && !tokens.has('flex-wrap') && !tokens.has('flex-col');
}

describe('q01 dashboards polish', () => {
  it('系统状态指标网格在 xl 才排成四列', () => {
    const source = readSource(ADMIN);
    const grid = statusMetricGrid(source);
    expect(grid, '系统状态指标网格').not.toBeNull();
    const className = grid === null ? '' : (attributeSource(grid.open, 'className') ?? '');
    const tokens = grid === null ? new Set<string>() : classTokens(grid.open, stringConstants(source));
    expect(tokens.has('md:grid-cols-4'), className).toBe(false);
    expect(tokens.has('grid-cols-2'), className).toBe(true);
    expect(tokens.has('xl:grid-cols-4'), className).toBe(true);
  });

  it('内存用量拆成主值和 hint，value 不再用斜杠拼总容量', () => {
    const source = readSource(ADMIN);
    const bound = bindings(source);
    const { value, hints } = memoryExpressions(source);
    const resolvedValue = expand(value, bound);
    expect(value.includes(' / ') || resolvedValue.includes(' / '), value).toBe(false);
    expect(carries(value, 'formatSize(usedMemory)', bound), value).toBe(true);
    expect(hints.some((hint) => carries(hint, 'formatSize(totalMemory)', bound))).toBe(true);
    const grid = statusMetricGrid(source);
    const passed = grid !== null && markup(source).some((item) => (
      item.name === 'Stat' && contains(grid, item.start) && attributeSource(item.open, 'hint') !== null
    ));
    expect(passed, '指标 Stat 应接收 hint').toBe(true);
  });

  it('系统状态和投递箱源码不含 break-all 或 break-words', () => {
    const problems = [ADMIN, DROPBOX].flatMap((file) => {
      const source = readSource(file);
      return ['break-all', 'break-words'].flatMap((token) => (
        offendingLines(source, token).map((line) => `${file} ${token} ${line}`)
      ));
    });
    expect(problems).toEqual([]);
  });

  it('处理器型号单行截断并带完整 title', () => {
    const admin = readSource(ADMIN);
    const constants = stringConstants(admin);
    const bound = bindings(admin);
    const model = modelElement(admin);
    expect(model, 'CPU 型号元素应使用 block min-w-0 truncate 并带 title').not.toBeNull();
    const title = model === null ? '' : (attributeSource(model.open, 'title') ?? '');
    expect(covers(title, /cpu\??\.(?:manufacturer|brand)/, bound), title).toBe(true);
    const cell = model === null ? null : cellContaining(admin, model.start);
    expect(cell, 'CPU 单元格').not.toBeNull();
    const truncates = cell === null ? [] : markup(admin).filter((item) => (
      contains(cell, item.start) && classTokens(item.open, constants).has('truncate')
    ));
    expect(truncates.length, '同格内第二个 truncate 会再次超高').toBe(1);
    expect(admin).toMatch(/cpu\??\.speed/);
    const speedAt = admin.search(/cpu\??\.speed/);
    const speedCell = cellContaining(admin, speedAt);
    if (speedCell !== null && cell !== null && speedCell.start === cell.start) {
      const sameRow = markup(admin).some((item) => (
        isRow(item.open, constants)
        && contains(cell, item.start)
        && contains(item, speedAt)
        && (contains(item, model?.start ?? -1) || (model !== null && contains(model, item.start)))
      ));
      expect(sameRow, '频率应放进同一行末尾，或移到单独一列').toBe(true);
      const subtle = markup(admin).some((item) => (
        contains(item, speedAt) && classTokens(item.open, constants).has('text-fg-subtle')
      ));
      expect(subtle, '频率文本应使用 text-fg-subtle').toBe(true);
    } else {
      expect(speedCell, '频率列').not.toBeNull();
    }
  });

  it('投递箱文件名以单行 truncate 显示并带完整 title', () => {
    const source = readSource(DROPBOX);
    const filename = filenameElement(source);
    expect(filename, '文件名元素应使用 block min-w-0 truncate 并带 title').not.toBeNull();
    const title = filename === null ? '' : (attributeSource(filename.open, 'title') ?? '');
    expect(covers(title, /file\.originalName/, bindings(source)), title).toBe(true);
    expect(source).toContain('truncate');
  });

  it('投递箱文件名列不设固定宽度，其它列保持', () => {
    const source = readSource(DROPBOX);
    const constants = stringConstants(source);
    const filename = headByText(source, '文件名');
    expect(filename, '文件名列').not.toBeNull();
    const filenameTokens = filename === null ? new Set<string>() : classTokens(filename.open, constants);
    for (const width of WIDTH_COLUMNS) {
      expect(filenameTokens.has(width), '文件名列').toBe(false);
    }
    expect(classTokens(headByText(source, '大小')?.open ?? '', constants).has('w-32')).toBe(true);
    expect(classTokens(headByText(source, '上传时间')?.open ?? '', constants).has('w-40')).toBe(true);
    expect(classTokens(headByText(source, '过期时间')?.open ?? '', constants).has('w-48')).toBe(true);
    expect(classTokens(headByText(source, '操作')?.open ?? '', constants).has('w-40')).toBe(true);
  });

  it('系统状态表和投递箱表的单元格保持单行', () => {
    const admin = readSource(ADMIN);
    const adminConstants = stringConstants(admin);
    const statusTable = serverStatusTable(admin);
    expect(statusTable, '系统状态表').not.toBeNull();
    const statusWraps = statusTable === null ? [] : markup(admin).filter((item) => (
      contains(statusTable, item.start)
      && (classTokens(item.open, adminConstants).has('flex-wrap') || classTokens(item.open, adminConstants).has('flex-col'))
    ));
    expect(statusWraps.map((item) => item.open), '系统状态表单元格不得换行或纵向堆叠').toEqual([]);

    const dropbox = readSource(DROPBOX);
    const constants = stringConstants(dropbox);
    const cell = fileActionCell(dropbox);
    expect(cell, '操作单元格').not.toBeNull();
    const body = cell === null ? '' : dropbox.slice(cell.openEnd, cell.end);
    const actions = cell === null ? [] : markup(dropbox).filter((item) => item.name === 'TableActions' && contains(cell, item.start));
    expect(actions.length, '下载和删除应在同一个操作行里').toBe(1);
    expect(body.includes('下载') && body.includes('删除'), body).toBe(true);
    const action = actions[0];
    if (action !== undefined) {
      const rendered = mergedActionClass(declaredClass(action.open, constants));
      const tokens = new Set(rendered.split(/\s+/).filter((token) => token.length > 0));
      expect(tokens.has('flex-wrap'), rendered).toBe(false);
      expect(tokens.has('flex-col'), rendered).toBe(false);
      expect(tokens.has('flex') || tokens.has('inline-flex'), rendered).toBe(true);
      return;
    }
    const row = cell === null ? null : smallest(markup(dropbox).filter((item) => (
      item.start > cell.start
      && contains(cell, item.start)
      && isRow(item.open, constants)
      && dropbox.slice(item.openEnd, item.end).includes('下载')
      && dropbox.slice(item.openEnd, item.end).includes('删除')
    )));
    expect(row, '操作按钮应排成不换行的一行').not.toBeNull();
    const rowTokens = row === null ? new Set<string>() : classTokens(row.open, constants);
    expect(rowTokens.has('flex-wrap'), row?.open ?? '').toBe(false);
  });

  it('统计页长按钮保持 sm 单行，文字截断并带组名 title', () => {
    const source = readSource(STATS);
    expect(offendingLines(source, 'h-auto!')).toEqual([]);
    expect(offendingLines(source, 'whitespace-normal')).toEqual([]);
    const bound = bindings(source);
    const constants = stringConstants(source);
    const button = smallest(markup(source).filter((item) => (
      item.name === 'Button' && covers(source.slice(item.openEnd, item.end), /group\.name/, bound)
    )));
    expect(button, '组名按钮').not.toBeNull();
    const open = button?.open ?? '';
    expect(open).toMatch(/\bsize\s*=\s*["']sm["']/);
    expect(classTokens(open, constants).has('max-w-full'), open).toBe(true);
    for (const token of ['h-auto!', 'whitespace-normal', 'py-1.5', 'text-left', 'break-words'] as const) {
      expect(classTokens(open, constants).has(token), open).toBe(false);
    }
    const title = attributeSource(open, 'title');
    expect(title, '按钮 title 应为组名').not.toBeNull();
    expect(covers(title ?? '', /group\.name/, bound), title ?? '').toBe(true);
    const label = button === null ? null : markup(source).find((item) => (
      item.name === 'span'
      && contains(button, item.start)
      && hasTokens(item.open, constants, ['min-w-0', 'truncate'])
      && covers(source.slice(item.openEnd, item.end), /group\.name/, bound)
    ));
    expect(label ?? null, '组名应包在 min-w-0 truncate 的 span 里').not.toBeNull();
  });

  it('焦点环常量不含 rounded-', () => {
    const source = readSource(STATS);
    const expression = bindings(source).get('FOCUS_RING');
    expect(expression, 'const FOCUS_RING').toBeDefined();
    expect(expression ?? '').not.toMatch(/rounded-/);
  });

  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });
});
