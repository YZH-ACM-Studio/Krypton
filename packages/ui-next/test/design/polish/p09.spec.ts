// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, readSource } from '../helpers.ts';

const PAGE = 'src/pages/user.tsx';

function sliceTopLevel(source: string, start: number, nextPattern: RegExp): string {
  const rest = source.slice(start);
  const next = rest.slice(1).search(nextPattern);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function topLevelFunction(source: string, name: string): string {
  const found = new RegExp(`(?:^|\\n)(?:export )?function ${name}\\b`).exec(source);
  if (found?.index === undefined) {
    return '';
  }
  const start = source[found.index] === '\n' ? found.index + 1 : found.index;
  return sliceTopLevel(source, start, /\n(?:export )?function /);
}

function topLevelValue(source: string, name: string): string {
  const found = new RegExp(`(?:^|\\n)(?:export )?(?:const|let) ${name}\\b`).exec(source);
  if (found?.index === undefined) {
    return '';
  }
  const start = source[found.index] === '\n' ? found.index + 1 : found.index;
  return sliceTopLevel(source, start, /\n(?:export )?(?:function |const |let )/);
}

function enclosingFunction(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) {
    return '';
  }
  const matches = [...source.slice(0, at).matchAll(/(?:^|\n)(?:export )?function /g)];
  const last = matches[matches.length - 1];
  if (last?.index === undefined) {
    return '';
  }
  const start = source[last.index] === '\n' ? last.index + 1 : last.index;
  return sliceTopLevel(source, start, /\n(?:export )?function /);
}

function referencedNames(body: string): string[] {
  const names = [
    ...body.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g),
    ...body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|\[)/g),
  ].map((match) => match[1] ?? '');
  return [...new Set(names)];
}

function withLocalCallees(source: string, body: string): string {
  const extras = referencedNames(body)
    .map((name) => topLevelFunction(source, name) || topLevelValue(source, name))
    .filter((text) => text.length > 0 && text !== body);
  return [body, ...extras].join('\n');
}

function ratingChartSource(source: string): string {
  return withLocalCallees(source, enclosingFunction(source, '<EChart'));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function heatmapSource(source: string): string {
  return stripComments(withLocalCallees(source, enclosingFunction(source, '最近一年的提交活跃度')));
}

describe('p09 user profile rating tooltip and activity heatmap', () => {
  it('rating 提示使用 SimpleTooltip', () => {
    const src = readSource(PAGE);
    const tooltipImport = /import\s+\{[\s\S]*?\}\s+from\s+['"]@\/components\/ui\/tooltip['"]/.exec(src)?.[0] ?? '';
    expect(tooltipImport).toMatch(/\bSimpleTooltip\b/);
    expect(ratingChartSource(src)).toMatch(/<SimpleTooltip\b/);
  });

  it('活跃度格子不含 bg-surface-hover 与 bg-brand，并使用 color-mix 与 --chart-1', () => {
    const heat = heatmapSource(readSource(PAGE));
    expect(heat).not.toContain('bg-surface-hover');
    expect(heat).not.toContain('bg-brand');
    expect(heat).toContain('bg-surface-active');
    expect(heat).toContain('color-mix(');
    expect(heat).toContain('--chart-1');
    expect(heat).toContain('in oklch');
    expect(heat).toContain('var(--surface-active)');
    expect(heat).toMatch(/(?<![.\d])25(?!\d)/);
    expect(heat).toMatch(/(?<![.\d])50(?!\d)/);
    expect(heat).toMatch(/(?<![.\d])75(?!\d)/);
    expect(heat).toMatch(/(?<![.\d])100(?!\d)/);
  });

  it('门禁零违规', () => {
    expectGateClean([PAGE]);
  });
});
