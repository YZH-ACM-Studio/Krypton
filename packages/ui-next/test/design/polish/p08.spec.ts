// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, readSource } from '../helpers.ts';

const LANE_FILES = [
  'src/pages/ranking.tsx',
  'src/pages/rankboard/index.tsx',
  'src/pages/rankboard/gallery.tsx',
] as const;

const RANKBOARD = 'src/pages/rankboard/index.tsx';
const GALLERY = 'src/pages/rankboard/gallery.tsx';

const SIZE_7 = /(?<![\w-])size-7(?![\w-])/;
const HIDDEN_CLASS = /(?<![\w-])hidden(?![\w-])/;

function exportedFunction(source: string, name: string): string {
  const marker = `export function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const next = source.indexOf('\nexport function ', start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function fileInputTags(source: string): string[] {
  const tags: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<input', cursor);
    if (start < 0) break;
    const end = source.indexOf('/>', start);
    if (end < 0) break;
    const tag = source.slice(start, end + 2);
    if (/\btype=["']file["']/.test(tag)) tags.push(tag);
    cursor = end + 2;
  }
  return tags;
}

function classText(tag: string): string {
  const literal = /\bclassName="([^"]*)"/.exec(tag);
  if (literal?.[1] !== undefined) return literal[1];
  const expression = /\bclassName=\{([\s\S]*?)\}/.exec(tag);
  return expression?.[1] ?? '';
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return start + 1;
  let index = start + 1;
  while (index < source.length) {
    const ch = source[index] ?? '';
    if (ch === '\\') {
      index += 2;
      continue;
    }
    if (ch === quote) return index + 1;
    if (quote !== '`' && (ch === '\n' || ch === '\r')) return index;
    index += 1;
  }
  return index;
}

function skipComment(source: string, start: number): number {
  const next = source[start + 1] ?? '';
  if (source[start] === '/' && next === '/') {
    const newline = source.indexOf('\n', start);
    return newline < 0 ? source.length : newline + 1;
  }
  if (source[start] === '/' && next === '*') {
    const end = source.indexOf('*/', start + 2);
    return end < 0 ? source.length : end + 2;
  }
  return start;
}

// 注释里的单词 rowHref 不能冒充 DataTable 属性。只记录开标签深度为 0 的 name=。
function dataTableProps(source: string): string[] {
  const props: string[] = [];
  let search = 0;
  while (search < source.length) {
    const start = source.indexOf('<DataTable', search);
    if (start < 0) break;
    const open = start + '<DataTable'.length;
    const boundary = source[open] ?? '';
    if (/[\w-]/.test(boundary)) {
      search = open;
      continue;
    }
    search = collectDataTableProps(source, open, props);
  }
  return props;
}

function collectDataTableProps(source: string, start: number, props: string[]): number {
  let index = start;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  while (index < source.length) {
    const ch = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (ch === '/' && (next === '/' || next === '*')) {
      index = skipComment(source, index);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      index = skipQuoted(source, index);
      continue;
    }
    if (brace === 0 && paren === 0 && bracket === 0) {
      if (ch === '>' || (ch === '/' && next === '>')) return index + (ch === '/' ? 2 : 1);
      if (ch === '{') {
        brace += 1;
        index += 1;
        continue;
      }
      if (ch === '(') {
        paren += 1;
        index += 1;
        continue;
      }
      if (ch === '[') {
        bracket += 1;
        index += 1;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const name = /^[A-Za-z_][\w-]*/.exec(source.slice(index))?.[0] ?? '';
        let eq = index + name.length;
        while (source[eq] === ' ' || source[eq] === '\n' || source[eq] === '\r' || source[eq] === '\t') eq += 1;
        if (name !== '' && source[eq] === '=') props.push(name);
        index += name.length;
        continue;
      }
      index += 1;
      continue;
    }
    if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    index += 1;
  }
  return index;
}

describe('p08 ranking keyboard rows, upload focus, avatar size, labels', () => {
  it('荣誉榜表格使用 rowHref', () => {
    const main = exportedFunction(readSource(RANKBOARD), 'RankBoardMainPage');
    const props = dataTableProps(main);
    expect(props, '荣誉榜 DataTable 应把 rowHref 写成属性，注释里的单词不算').toContain('rowHref');
  });

  it('照片墙文件 input 含 sr-only 且不含 hidden', () => {
    const tags = fileInputTags(readSource(GALLERY));
    expect(tags.length).toBeGreaterThan(0);
    for (const value of tags.map((tag) => classText(tag))) {
      expect(value).toContain('sr-only');
      expect(value).not.toMatch(HIDDEN_CLASS);
    }
  });

  it('三个文件不出现 size-7', () => {
    const hits = LANE_FILES.flatMap((file) => readSource(file).split('\n').flatMap((line, index) => (
      SIZE_7.test(line) ? [`${file}:${index + 1} ${line.trim()}`] : []
    )));
    expect(hits).toEqual([]);
  });

  it('存在 aria-label="查看大图"', () => {
    const found = LANE_FILES.some((file) => readSource(file).includes('aria-label="查看大图"'));
    expect(found, '应存在 aria-label="查看大图"').toBe(true);
  });

  it('设计门禁对本 lane 文件为零违规', () => {
    expectGateClean([...LANE_FILES]);
  });
});
