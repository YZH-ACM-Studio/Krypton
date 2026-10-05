// @vitest-environment jsdom
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProblemTestdataFileDialog } from '../../../src/components/problem-testdata-file-dialog';

const packageRoot = resolve(import.meta.dirname, '../../..');

const MANAGE = 'src/pages/problem-manage.tsx';
const PREVIEW = 'src/components/problem-testdata-file-dialog.tsx';

const LANE_FILES = [MANAGE, PREVIEW] as const;

function readSource(file: string): string {
  return readFileSync(resolve(packageRoot, file), 'utf8');
}

function expectFilesGateClean(files: readonly string[]): void {
  for (const file of files) {
    const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', file], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.error ?? null, file).toBeNull();
    expect(result.status, `${file}\n${result.stdout}\n${result.stderr}`).toBe(0);
  }
}

/** 超过预览上限，避免打开对话框时发请求；高度类不依赖文件大小。 */
const OVERSIZED_FILE_BYTES = 1024 * 1024 + 1;

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\w$]/.test(ch);
}

function lineOf(source: string, index: number): number {
  let line = 1;
  const end = Math.min(index, source.length);
  for (let cursor = 0; cursor < end; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function skipLineComment(source: string, index: number): number {
  const next = source.indexOf('\n', index);
  return next < 0 ? source.length : next;
}

function skipBlockComment(source: string, index: number): number {
  const next = source.indexOf('*/', index + 2);
  return next < 0 ? source.length : next + 2;
}

/** 返回闭合引号的下标。模板插值里的括号成对跳过，不计入外层函数体。 */
function skipString(source: string, index: number): number {
  const quote = source[index] ?? '';
  if (quote !== '"' && quote !== "'" && quote !== '`') return index;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (quote === '`' && source[cursor] === '$' && source[cursor + 1] === '{') {
      let depth = 1;
      cursor += 2;
      while (cursor < source.length && depth > 0) {
        const ch = source[cursor];
        if (ch === '"' || ch === "'" || ch === '`') {
          cursor = skipString(source, cursor) + 1;
          continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        cursor += 1;
      }
      cursor -= 1;
      continue;
    }
    if (source[cursor] === quote) return cursor;
  }
  return source.length - 1;
}

function maskNonCode(source: string): string {
  const chars = source.split('');
  const blank = (from: number, to: number) => {
    for (let cursor = from; cursor < to && cursor < chars.length; cursor += 1) {
      if (chars[cursor] !== '\n') chars[cursor] = ' ';
    }
  };
  let cursor = 0;
  while (cursor < source.length) {
    if (source.startsWith('//', cursor)) {
      const end = skipLineComment(source, cursor);
      blank(cursor, end);
      cursor = end;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      const end = skipBlockComment(source, cursor);
      blank(cursor, end);
      cursor = end;
      continue;
    }
    const ch = source[cursor];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(source, cursor);
      blank(cursor, end + 1);
      cursor = end + 1;
      continue;
    }
    cursor += 1;
  }
  return chars.join('');
}

function findFunctionBody(source: string, name: string): { start: number; end: number } | null {
  const marker = `function ${name}`;
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(marker, from);
    if (start < 0) return null;
    if (isIdentChar(source[start - 1])) {
      from = start + marker.length;
      continue;
    }
    let cursor = start + marker.length;
    let paren = 0;
    let sawParen = false;
    let open = -1;
    while (cursor < source.length) {
      if (source.startsWith('//', cursor)) {
        cursor = skipLineComment(source, cursor);
        continue;
      }
      if (source.startsWith('/*', cursor)) {
        cursor = skipBlockComment(source, cursor);
        continue;
      }
      const ch = source[cursor];
      if (ch === '"' || ch === "'" || ch === '`') {
        cursor = skipString(source, cursor) + 1;
        continue;
      }
      if (ch === '(') {
        paren += 1;
        sawParen = true;
      } else if (ch === ')') {
        paren -= 1;
      } else if (ch === '{' && paren === 0 && sawParen) {
        open = cursor;
        break;
      } else if ((ch === ';' || ch === '=') && paren === 0) {
        break;
      }
      cursor += 1;
    }
    if (open < 0) {
      from = start + marker.length;
      continue;
    }
    let depth = 0;
    cursor = open;
    while (cursor < source.length) {
      if (source.startsWith('//', cursor)) {
        cursor = skipLineComment(source, cursor);
        continue;
      }
      if (source.startsWith('/*', cursor)) {
        cursor = skipBlockComment(source, cursor);
        continue;
      }
      const ch = source[cursor];
      if (ch === '"' || ch === "'" || ch === '`') {
        cursor = skipString(source, cursor) + 1;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return { start, end: cursor };
      }
      cursor += 1;
    }
    return null;
  }
  return null;
}

/** `function` 与 `const` 都算定义：重挂来自组件类型身份，不来自声明关键字。 */
function fileSectionDefinitionLines(source: string): number[] {
  const masked = maskNonCode(source);
  const pattern = /(?:^|[^\w$])(?:export\s+)?(?:async\s+)?function\s+FileSection\b|(?:^|[^\w$])(?:export\s+)?(?:const|let|var)\s+FileSection\b/g;
  const lines: number[] = [];
  for (const match of masked.matchAll(pattern)) {
    const text = match[0];
    const local = text.lastIndexOf('FileSection');
    if (local < 0) continue;
    lines.push(lineOf(source, (match.index ?? 0) + local));
  }
  return lines;
}

function quotedStrings(source: string): string[] {
  const values: string[] = [];
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'" && quote !== '`') continue;
    const end = skipString(source, cursor);
    values.push(source.slice(cursor + 1, end));
    cursor = end;
  }
  return values;
}

function classTokensFromOpenTag(tag: string): string[] {
  const attr = /className=(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/.exec(tag);
  if (attr == null) return [];
  const literal = attr[1] ?? attr[2];
  const pieces = literal != null ? [literal] : quotedStrings(attr[3] ?? '');
  return pieces.flatMap((piece) => piece.split(/\s+/).filter((token) => token.length > 0));
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function findOpenTags(source: string, tag: string): { line: number; text: string }[] {
  const needle = `<${tag}`;
  const tags: { line: number; text: string }[] = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(needle, from);
    if (start < 0) break;
    const boundary = source[start + needle.length];
    if (boundary !== undefined && /[\w$:-]/.test(boundary)) {
      from = start + needle.length;
      continue;
    }
    const end = findTagEnd(source, start);
    if (end < 0) {
      from = start + needle.length;
      continue;
    }
    tags.push({ line: lineOf(source, start), text: source.slice(start, end + 1) });
    from = end + 1;
  }
  return tags;
}

function findTagEnd(source: string, start: number): number {
  let depth = 0;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const ch = source[cursor];
    if (ch === '"' || ch === "'" || ch === '`') {
      cursor = skipString(source, cursor);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '>' && depth === 0) return cursor;
  }
  return -1;
}

describe('q18 problem files preview height and file list', () => {
  it('预览对话框源码不含 max-sm:，DialogContent 开标签含无前缀 h-dvh', () => {
    const source = readSource(PREVIEW);
    expect(source.includes('max-sm:')).toBe(false);
    const tags = findOpenTags(source, 'DialogContent');
    expect(tags.length).toBeGreaterThan(0);
    const tokens = tags.flatMap((tag) => classTokensFromOpenTag(tag.text));
    expect(tokens).toContain('h-dvh');
  });

  it('渲染后的 DialogContent 同时保留无前缀 h-dvh 与 size=full 的 sm:h-', async () => {
    render(
      <ProblemTestdataFileDialog
        file={{ name: 'huge.in', size: OVERSIZED_FILE_BYTES }}
        problemUrl="/p/P1000"
        onClose={() => undefined}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const tokens = classTokens(dialog);
    expect({
      unprefixedDvh: tokens.includes('h-dvh'),
      smHeight: tokens.some((token) => token.startsWith('sm:h-')),
      maxSm: tokens.some((token) => token.startsWith('max-sm:')),
    }).toEqual({
      unprefixedDvh: true,
      smHeight: true,
      maxSm: false,
    });
  });

  it('fileSection 定义在 ProblemFilesPage 函数体之外', () => {
    const source = readSource(MANAGE);
    const page = findFunctionBody(source, 'ProblemFilesPage');
    expect(page).not.toBeNull();
    if (page == null) return;
    const definitions = fileSectionDefinitionLines(source);
    expect(definitions.length).toBeGreaterThan(0);
    const inside = definitions.filter((line) => line > lineOf(source, page.start) && line < lineOf(source, page.end));
    expect(inside, `ProblemFilesPage 在 ${lineOf(source, page.start)}-${lineOf(source, page.end)} 行`).toEqual([]);
  });

  it('题目文件页不含 border-brand', () => {
    expect(readSource(MANAGE).includes('border-brand')).toBe(false);
  });

  it('本 lane 源文件通过设计门禁', () => {
    expectFilesGateClean(LANE_FILES);
  });
});
