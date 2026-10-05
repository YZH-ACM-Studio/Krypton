// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const PAGE = 'src/pages/contest-manage.tsx';
const M07 = 'test/design/pages/m07.design.spec.ts';
const TEMPORAL_TYPES = new Set(['datetime-local', 'date', 'time']);
const OLD_EDIT_GRID_TITLE = '编辑页主网格带 2xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]';

interface SourceFunction {
  name: string;
  start: number;
  body: string;
}

interface ClassToken {
  prefixes: string[];
  utility: string;
}

interface QuoteRead {
  value: string;
  next: number;
}

/** 验收允许输入或外层网格子项二选一；行为规格要求日期/时间输入带 w-full min-w-0，这里锁定输入开标签。 */
const TEMPORAL_INPUT_CLASSES = ['w-full', 'min-w-0'] as const;

const FORBIDDEN_COLUMN: { label: string; pattern: RegExp }[] = [
  { label: '2xl:grid-cols-[', pattern: /(?<![\w-])2xl:grid-cols-\[/g },
  { label: 'lg:grid-cols-', pattern: /(?<![\w-])lg:grid-cols-/g },
  { label: 'xl:grid-cols-', pattern: /(?<![\w-])xl:grid-cols-/g },
];

function listFunctions(source: string): SourceFunction[] {
  const pattern = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;
  const matches = [...source.matchAll(pattern)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1];
    const end = next?.index ?? source.length;
    return {
      name: match[1] ?? '',
      start,
      body: source.slice(start, end),
    };
  });
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function isQuote(char: string | undefined): char is '"' | "'" | '`' {
  return char === '"' || char === "'" || char === '`';
}

function readQuoted(source: string, index: number): QuoteRead | null {
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

function matchBrace(source: string, openIndex: number): number {
  if (source[openIndex] !== '{') return -1;
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
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

function stringLiterals(source: string): string[] {
  const values: string[] = [];
  let index = 0;
  while (index < source.length) {
    if (!isQuote(source[index])) {
      index += 1;
      continue;
    }
    const quoted = readQuoted(source, index);
    if (quoted === null) {
      index += 1;
      continue;
    }
    values.push(quoted.value);
    index = quoted.next;
  }
  return values;
}

function readAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)\s*\\})`,
  );
  const match = pattern.exec(tag);
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? null;
}

function sliceBraces(source: string, openIndex: number): string {
  const end = matchBrace(source, openIndex);
  if (end < 0) return '';
  return source.slice(openIndex + 1, end);
}

function classToken(token: string): ClassToken {
  const cleaned = token.replace(/!$/, '');
  const raw = cleaned.startsWith('!') ? cleaned.slice(1) : cleaned;
  const parts = raw.split(':');
  return {
    prefixes: parts.slice(0, -1),
    utility: parts[parts.length - 1] ?? '',
  };
}

function classTokensFromTag(tag: string): string[] {
  const marker = /\bclassName\s*=/.exec(tag);
  if (marker === null || marker.index === undefined) return [];
  let index = marker.index + marker[0].length;
  while (tag[index] === ' ' || tag[index] === '\n' || tag[index] === '\t') index += 1;
  const opener = tag[index];
  if (opener === '"' || opener === "'") {
    const end = tag.indexOf(opener, index + 1);
    const value = end < 0 ? '' : tag.slice(index + 1, end);
    return value.split(/\s+/).filter((token) => token.length > 0);
  }
  if (opener !== '{') return [];
  const expression = sliceBraces(tag, index);
  const literals = stringLiterals(expression);
  const pieces = literals.length > 0 ? literals : [expression];
  return pieces.flatMap((value) => value.split(/\s+/).filter((token) => token.length > 0));
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** 编辑页区段 = ContestManagementChrome、ContestEditPage，以及渲染 active="edit" 的函数（含 ACM 表单）。 */
function editFunctions(source: string): SourceFunction[] {
  const functions = listFunctions(source);
  const chrome = functions.find((item) => item.name === 'ContestManagementChrome');
  const editPage = functions.find((item) => item.name === 'ContestEditPage');
  expect(chrome, 'function ContestManagementChrome').toBeDefined();
  expect(editPage, 'export function ContestEditPage').toBeDefined();
  if (chrome === undefined || editPage === undefined) return [];
  const selected = new Map<string, SourceFunction>();
  selected.set(chrome.name, chrome);
  selected.set(editPage.name, editPage);
  for (const item of functions) {
    const editsEdit = findOpenTags(item.body, 'ContestManagementChrome').some((tag) => readAttribute(tag.text, 'active') === 'edit');
    if (editsEdit) selected.set(item.name, item);
  }
  const section = [...selected.values()];
  const text = section.map((item) => item.body).join('\n');
  expect(text, '编辑页区段要包含考试座位入口').toContain('ContestExamSeatEntry');
  expect(text, '编辑页区段要包含 ACM 表单的开始日期').toContain('beginAtDate');
  expect(text, '编辑页区段要包含 active="edit"').toContain('active="edit"');
  return section;
}

function forbiddenColumns(source: string, functions: SourceFunction[]): string[] {
  const hits: string[] = [];
  for (const item of functions) {
    for (const rule of FORBIDDEN_COLUMN) {
      const pattern = new RegExp(rule.pattern.source, 'g');
      for (let match = pattern.exec(item.body); match !== null; match = pattern.exec(item.body)) {
        const index = item.start + (match.index ?? 0);
        const line = lineAt(source, index);
        const snippet = oneLine(source.split('\n')[line - 1] ?? '');
        hits.push(`${item.name}:${line} ${rule.label} ${snippet}`);
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
    }
  }
  return hits;
}

function gridColumnViolations(functions: SourceFunction[]): { violations: string[]; smGridCols2: number } {
  const violations: string[] = [];
  let smGridCols2 = 0;
  for (const item of functions) {
    for (const literal of stringLiterals(item.body)) {
      if (!literal.includes('grid-cols-')) continue;
      for (const token of literal.split(/\s+/)) {
        if (token.length === 0) continue;
        const parts = classToken(token);
        if (parts.utility === 'grid-cols-2') {
          if (parts.prefixes.length === 1 && parts.prefixes[0] === 'sm') smGridCols2 += 1;
          else violations.push(`${item.name}: grid-cols-2 必须以 sm: 为前缀，实际是 ${token}`);
        }
        const numeric = /^grid-cols-(\d+)$/.exec(parts.utility);
        const columns = numeric === null ? 0 : Number(numeric[1]);
        if (parts.prefixes.length === 0 && columns >= 3) {
          violations.push(`${item.name}: 出现无前缀的 ${token}`);
        }
      }
    }
  }
  return { violations, smGridCols2 };
}

function temporalInputTags(functions: SourceFunction[]): { owner: string; text: string }[] {
  const tags: { owner: string; text: string }[] = [];
  for (const item of functions) {
    for (const tagName of ['Input', 'input'] as const) {
      for (const tag of findOpenTags(item.body, tagName)) {
        const type = readAttribute(tag.text, 'type');
        if (type !== null && TEMPORAL_TYPES.has(type)) tags.push({ owner: item.name, text: tag.text });
      }
    }
  }
  return tags;
}

describe('q17 contest edit page layout above 1536px', () => {
  it('编辑页区段不含 2xl:grid-cols-[、lg:grid-cols-、xl:grid-cols-', () => {
    const source = readSource(PAGE);
    const hits = forbiddenColumns(source, editFunctions(source));
    expect(hits).toEqual([]);
  });

  it('编辑页区段里 grid-cols-2 都以 sm: 出现，且没有无前缀的 grid-cols-3 及以上', () => {
    const source = readSource(PAGE);
    const columns = gridColumnViolations(editFunctions(source));
    expect(columns.smGridCols2, '编辑表单要保留 sm:grid-cols-2').toBeGreaterThan(0);
    expect(columns.violations).toEqual([]);
  });

  it('日期、时间、datetime-local 输入开标签带 w-full 与 min-w-0', () => {
    const source = readSource(PAGE);
    const inputs = temporalInputTags(editFunctions(source));
    expect(inputs.length, '编辑页区段里的日期/时间输入').toBeGreaterThan(0);
    const violations = inputs.flatMap((input) => {
      const tokens = classTokensFromTag(input.text);
      const missing = TEMPORAL_INPUT_CLASSES.filter((token) => !tokens.includes(token));
      if (missing.length === 0) return [];
      return [`${input.owner}: 缺少 ${missing.join(' ')} ${oneLine(input.text)}`];
    });
    expect(violations).toEqual([]);
  });

  it('m07 不再要求 2xl 两列主网格，并写明编辑页不含这些列断点', () => {
    const text = readSource(M07);
    const problems: string[] = [];
    if (text.includes(OLD_EDIT_GRID_TITLE)) problems.push(`仍有旧断言「${OLD_EDIT_GRID_TITLE}」`);
    if (/主网格缺少 \$\{EDIT_GRID\}/.test(text)) problems.push('editSeatGrids 仍把缺少 EDIT_GRID 当成问题');
    if (!/(?<![\w-])lg:grid-cols-/.test(text)) problems.push('没有写明不含 lg:grid-cols-');
    if (!/(?<![\w-])xl:grid-cols-/.test(text)) problems.push('没有写明不含 xl:grid-cols-');
    if (!/(?<![\w-])2xl:grid-cols-\[/.test(text)) problems.push('没有写明不含 2xl:grid-cols-[');
    expect(problems).toEqual([]);
  });

  it('比赛编辑页门禁零违规', () => {
    expectGateClean([PAGE]);
  });
});
