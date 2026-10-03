// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean, readSource } from '../helpers';

const FILES = [
  'src/components/programming-statement.tsx',
  'src/components/sample-blocks.tsx',
  'src/components/markdown-renderer.tsx',
  'src/components/anti-ai-copy-boundary.tsx',
];

function classNameValues(source: string): string[] {
  const values: string[] = [];
  let search = 0;
  while (search < source.length) {
    const at = source.indexOf('className=', search);
    if (at < 0) break;
    const cursor = at + 'className='.length;
    if (source.startsWith('"', cursor)) {
      const end = source.indexOf('"', cursor + 1);
      if (end < 0) break;
      values.push(source.slice(cursor + 1, end));
      search = end + 1;
      continue;
    }
    if (source.startsWith('{`', cursor)) {
      const end = source.indexOf('`}', cursor + 2);
      if (end < 0) break;
      values.push(source.slice(cursor + 2, end));
      search = end + 2;
      continue;
    }
    if (source.startsWith('{cn(', cursor)) {
      const open = cursor + 3;
      const close = closeParen(source, open);
      if (close < 0) break;
      values.push(quotedText(source.slice(open + 1, close)));
      search = close + 1;
      continue;
    }
    search = cursor;
  }
  return values;
}

function closeParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function quotedText(source: string): string {
  const parts: string[] = [];
  for (const match of source.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return parts.join(' ');
}

function classTokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 0 && !token.includes('${')));
}

function expectTokens(source: string, tokens: readonly string[]): void {
  const found = classNameValues(source).some((value) => {
    const present = classTokens(value);
    return tokens.every((token) => present.has(token));
  });
  expect({ tokens, found }).toEqual({ tokens, found: true });
}

function expectAbsent(source: string, token: string): void {
  const hits = classNameValues(source).filter((value) => classTokens(value).has(token));
  expect(hits).toEqual([]);
}

function expectSmSampleColumns(source: string): void {
  const columns = classNameValues(source).flatMap((value) => [...classTokens(value)].filter((token) => token.includes('grid-cols-2')));
  expect(columns.length).toBeGreaterThan(0);
  for (const column of columns) {
    expect(column).toBe('sm:grid-cols-2');
  }
}

describe('s04 problem statement, samples and markdown', () => {
  it('门禁零违规', () => {
    expectGateClean(FILES);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants(FILES);
  });

  it('样例框按 §7.5', () => {
    const samples = readSource('src/components/sample-blocks.tsx');
    expectTokens(samples, ['rounded-md', 'border', 'border-line', 'bg-surface-sunken']);
    expectTokens(samples, ['h-8', 'justify-between']);
    expectTokens(samples, ['text-xs', 'font-medium', 'text-fg-muted']);
    expectTokens(samples, ['font-mono', 'text-sm', 'leading-relaxed', 'overflow-x-auto']);
    expectAbsent(samples, 'whitespace-pre-wrap');
    expectAbsent(samples, 'break-all');
    expectSmSampleColumns(samples);

    const statement = readSource('src/components/programming-statement.tsx');
    expectAbsent(statement, 'whitespace-pre-wrap');
    expectAbsent(statement, 'break-all');
    const delegates = /<SampleBlocks?(?=[\s>])/.test(statement);
    if (!delegates) {
      expectTokens(statement, ['rounded-md', 'border', 'border-line', 'bg-surface-sunken']);
      expectTokens(statement, ['h-8', 'justify-between']);
      expectTokens(statement, ['text-xs', 'font-medium', 'text-fg-muted']);
      expectTokens(statement, ['font-mono', 'text-sm', 'leading-relaxed', 'overflow-x-auto']);
      expectSmSampleColumns(statement);
    }
  });

  it('题面 Markdown 使用 krypton-prose', () => {
    expect(readSource('src/components/markdown-renderer.tsx')).toContain('krypton-prose');
  });

  it('题面编辑器外壳不用手写断点和视口高度', () => {
    const source = readSource('src/components/markdown-renderer.tsx');
    const forbidden = /max-(?:sm|md|lg|xl|2xl|3xl):|\[@media|\[-?(?:\d+(?:\.\d+)?|\.\d+)(?:svh|dvh|lvh|vh)\]/;
    const hits = source.split('\n').flatMap((line, index) => (forbidden.test(line) ? [`${index + 1}:${line.trim()}`] : []));
    expect(hits).toEqual([]);
  });

  it('题面小标题为 text-lg font-semibold', () => {
    const tags = [...readSource('src/components/programming-statement.tsx').matchAll(/<h[23]\b[^>]*>/g)].map((match) => match[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const quoted = /className="([^"]*)"/.exec(tag);
      const tokens = classTokens(quoted?.[1] ?? '');
      expect({ tag, textLg: tokens.has('text-lg'), semibold: tokens.has('font-semibold') }).toEqual({
        tag,
        textLg: true,
        semibold: true,
      });
    }
  });

  it('防 AI 复制边界保持复制拦截与失败文案', () => {
    const source = readSource('src/components/anti-ai-copy-boundary.tsx');
    expect(source).toContain('export function createAntiAiMarkerRehypePlugins');
    expect(source).toContain('export function AntiAiCopyBoundary');
    expect(source).toContain('data-anti-ai-copy-scope');
    expect(source).toContain('onCopy={handleCopy}');
    expect(source).toContain('onCut={handleCopy}');
    expect(source).toContain('复制或剪切失败：浏览器无法同时写入纯文本和富文本，请重试或更换浏览器。');
  });
});
