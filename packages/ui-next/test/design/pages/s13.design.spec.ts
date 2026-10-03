// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/user.tsx';
const RATING_ROW_TOKENS = ['grid', 'w-full', 'min-w-0', 'gap-6'] as const;

// expectPageStructure only rejects widths that were not listed. These checks
// require the listed width on the <Page tag of that page function.
function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function pageWidth(width: 'wide' | 'form'): RegExp {
  return new RegExp(`<Page\\b[^>]*\\bwidth="${width}"`);
}

function quotedStrings(source: string): string[] {
  return [...source.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '');
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 0));
}

function ratingRowClass(source: string): string | undefined {
  return quotedStrings(source).find((value) => {
    const tokens = tokenSet(value);
    return RATING_ROW_TOKENS.every((token) => tokens.has(token));
  });
}

function requireRatingRowClass(source: string): string {
  const row = ratingRowClass(source);
  expect(row).toEqual(expect.any(String));
  if (typeof row !== 'string') {
    return '';
  }
  return row;
}

function ratingColumnsAreConditional(source: string): boolean {
  return /length\s*>\s*1\s*(?:&&|\?)\s*['"]sm:grid-cols-2['"]/.test(source);
}

function lastOpenIndex(source: string, tag: string): number {
  const pattern = new RegExp(`<${tag}(?=[\\s>/])`, 'g');
  let last = -1;
  for (const match of source.matchAll(pattern)) {
    if (match.index !== undefined) {
      last = match.index;
    }
  }
  return last;
}

function tagWraps(source: string, tag: string, child: string): boolean {
  const childAt = source.indexOf(child);
  if (childAt < 0) {
    return false;
  }
  const before = source.slice(0, childAt);
  const openAt = lastOpenIndex(before, tag);
  if (openAt < 0) {
    return false;
  }
  const slice = before.slice(openAt);
  const end = slice.indexOf('>');
  if (end >= 0 && slice[end - 1] === '/') {
    return false;
  }
  return !slice.includes(`</${tag}>`);
}

describe('s13 user profile', () => {
  it('门禁零违规', () => {
    expectGateClean([PAGE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([PAGE]);
  });

  it('页面结构 user.tsx', () => {
    expectPageStructure(PAGE, {
      widths: ['wide', 'form'],
      workspace: 'forbidden',
      minPageHeaders: 4,
    });
  });

  it('两个外站 Rating 同时可见时，中屏排成两列', () => {
    const src = readSource(PAGE);
    expect(src).toContain('sm:grid-cols-2');
    expect(ratingColumnsAreConditional(src)).toBe(true);
  });

  it('两列网格只在可见站点多于一个时加上，并且行本身全宽可收缩', () => {
    const src = readSource(PAGE);
    const row = requireRatingRowClass(src);
    expect(tokenSet(row).has('sm:grid-cols-2')).toBe(false);
    expect(ratingColumnsAreConditional(src)).toBe(true);
  });

  it('外站 Rating 区域不得再被收成 max-w-xl', () => {
    expect(readSource(PAGE)).not.toContain('max-w-xl');
  });

  it('rating 历史图固定 240px 高、全宽且允许收缩', () => {
    const block = functionBody(readSource(PAGE), 'ExternalRatingSiteBlock');
    expect(block).toContain('<EChart');
    expect(block).toContain('h-[240px] w-full min-w-0');
  });

  it('两个站点都公开时，渲染出的 Rating 行在中屏是两列', () => {
    const src = readSource(PAGE);
    expect(requireRatingRowClass(src).length).toBeGreaterThan(0);
    expect(ratingColumnsAreConditional(src)).toBe(true);
  });

  it('双站 Rating 行不得带 max-w-xl', () => {
    const src = readSource(PAGE);
    expect(requireRatingRowClass(src)).not.toContain('max-w-xl');
    expect(src).not.toContain('max-w-xl');
  });

  it('只公开一个站点时，Rating 行不得排成两列', () => {
    const src = readSource(PAGE);
    expect(tokenSet(requireRatingRowClass(src)).has('sm:grid-cols-2')).toBe(false);
    expect(ratingColumnsAreConditional(src)).toBe(true);
  });

  it('单站 Rating 行不得带 max-w-xl', () => {
    const src = readSource(PAGE);
    expect(requireRatingRowClass(src)).not.toContain('max-w-xl');
    expect(src).not.toContain('max-w-xl');
  });

  it('有历史点时挂载的图表高度为 240px', () => {
    const block = functionBody(readSource(PAGE), 'ExternalRatingSiteBlock');
    expect(block).toMatch(/history\.length\s*>=\s*1[\s\S]*<EChart\b[^>]+h-\[240px\]/);
  });

  it('本人仍能看到未公开手柄留下的历史图，且高度为 240px', () => {
    const block = functionBody(readSource(PAGE), 'ExternalRatingSiteBlock');
    expect(block).toContain('h-[240px]');
    expect(block).toMatch(/<EChart\b/);
  });

  it('completionList 的标题保留 break-words', () => {
    const list = functionBody(readSource(PAGE), 'CompletionList');
    expect(list).toMatch(/<p\b[^>]+break-words[^>]*>\s*\{item\.title\}/);
  });

  it('源码不得出现 w-24 truncate', () => {
    expect(readSource(PAGE)).not.toContain('w-24 truncate');
  });

  it('userDetailPage 是原型 B，用户名标题由 PageHeader 提供', () => {
    const body = functionBody(readSource(PAGE), 'UserDetailPage');
    expect(body).toMatch(pageWidth('wide'));
    expect(body).toMatch(/<PageHeader\b[^>]+title=\{(?:name|udoc\.uname)\b/);
    expect(body).not.toMatch(/<h1\b/);
    expect(body).not.toMatch(/\btext-3xl\b/);
  });

  it('局部 KpiCard 换成 Stat', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/\bfunction KpiCard\b/);
    expect(src).not.toMatch(/<KpiCard\b/);
    expect(src).toMatch(/import\s+\{[\s\S]*?\bStat\b[\s\S]*?\}\s+from\s+['"]@\/components\/ui\/display['"]/);
    expect(functionBody(src, 'UserDetailPage')).toMatch(/<Stat\b/);
  });

  it('图表外层 Panel', () => {
    const src = readSource(PAGE);
    expect(src).toMatch(/import\s+\{[\s\S]*?\bPanel\b[\s\S]*?\}\s+from\s+['"]@\/components\/ui\/panel['"]/);
    const block = functionBody(src, 'ExternalRatingSiteBlock');
    const detail = functionBody(src, 'UserDetailPage');
    // §6.28：Rating 区的 Card 换成一层 Panel。图表里再套 Panel 仍是卡片套卡片。
    expect(`${detail}\n${block}`).not.toMatch(/<Card(?:Header|Title|Description|Content|Footer)?(?=[\s>/])/);
    expect(tagWraps(detail, 'Panel', '<ExternalRatingSiteBlock')).toBe(true);
    expect(tagWraps(block, 'Panel', '<EChart')).toBe(false);
  });

  it('settingsPage 与 securityPage 是原型 C，宽度为 form', () => {
    const src = readSource(PAGE);
    for (const name of ['SettingsPage', 'SecurityPage'] as const) {
      const body = functionBody(src, name);
      expect(body, name).toMatch(pageWidth('form'));
      expect(body, name).toMatch(/<PageHeader\b/);
    }
  });

  it('messagesPage 用 wide', () => {
    const body = functionBody(readSource(PAGE), 'MessagesPage');
    expect(body).toMatch(pageWidth('wide'));
    expect(body).toMatch(/<PageHeader\b/);
  });
});
