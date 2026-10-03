// @vitest-environment node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countMatches,
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/home.tsx',
  'src/components/announcement-home-block.tsx',
  'src/components/collect-home-block.tsx',
  'src/components/collect-pending-badge.tsx',
] as const;

const HOME = 'src/pages/home.tsx';
const ANNOUNCE = 'src/components/announcement-home-block.tsx';
const COLLECT = 'src/components/collect-home-block.tsx';
const DEAD_HOME = resolve(import.meta.dirname, '../../..', 'src/routes/home-page.tsx');

function classLists(source: string): string[][] {
  const lists: string[][] = [];
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    const value = match[1] ?? '';
    lists.push(value.split(/\s+/).filter((token) => token.length > 0));
  }
  return lists;
}

function hasClassList(source: string, tokens: readonly string[]): boolean {
  return classLists(source).some((list) => tokens.every((token) => list.includes(token)));
}

function openTags(source: string, tag: string): string[] {
  return findOpenTags(source, tag).map((item) => item.text);
}

function tagClassTokens(tag: string): string[] {
  const match = /className="([^"]*)"/.exec(tag);
  const value = match?.[1] ?? '';
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function tagHasClasses(source: string, tag: string, tokens: readonly string[]): boolean {
  return openTags(source, tag).some((text) => tokens.every((token) => tagClassTokens(text).includes(token)));
}

function tagWithClassesThen(source: string, tag: string, tokens: readonly string[], after: RegExp): boolean {
  let from = 0;
  for (const open of findOpenTags(source, tag)) {
    if (!tokens.every((token) => tagClassTokens(open.text).includes(token))) {
      continue;
    }
    const index = source.indexOf(open.text, from);
    if (index < 0) {
      continue;
    }
    from = index + open.text.length;
    if (after.test(source.slice(from))) {
      return true;
    }
  }
  return false;
}

function quotedHas(source: string, names: readonly string[]): boolean {
  const strings = source.match(/['"`][^'"`]*['"`]/g) ?? [];
  return strings.some((text) => names.every((name) => text.includes(name)));
}

function panelBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const match of source.matchAll(/<Panel\b[^>]*>/g)) {
    const start = match.index;
    if (start === undefined) {
      continue;
    }
    const close = source.indexOf('</Panel>', start + match[0].length);
    if (close === -1) {
      continue;
    }
    bodies.push(source.slice(start + match[0].length, close));
  }
  return bodies;
}

function isPrototypeGrid(tokens: readonly string[]): boolean {
  if (!tokens.includes('min-w-0') || !tokens.includes('gap-4')) {
    return false;
  }
  if (tokens.includes('lg:grid-cols-2')) {
    return true;
  }
  // 题集小卡已有 sm:grid-cols-2 + xl:grid-cols-3，不能把它当成仪表盘栅格。
  return tokens.includes('xl:grid-cols-3') && !tokens.includes('sm:grid-cols-2');
}

function hasShrinkableDashboardGrid(source: string): boolean {
  return classLists(source).some((tokens) => isPrototypeGrid(tokens));
}

/** §4.3：md 起四列并加竖线。必须是完整 token，lg:grid-cols-4 不能冒充 md:grid-cols-4。 */
const STAT_ROW_TOKENS = ['grid-cols-2', 'md:grid-cols-4', 'md:divide-x', 'md:divide-line-subtle'] as const;

function isStatRow(tokens: readonly string[]): boolean {
  return STAT_ROW_TOKENS.every((token) => tokens.includes(token));
}

describe('s01 home dashboard and home blocks', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 home.tsx', () => {
    expectPageStructure(HOME, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('首页是居中的限宽阅读壳，而不是无界铺满', () => {
    const src = readSource(HOME);
    // max-w-[90rem] 触发 DS004；限宽改由 Page width="wide"（80rem）表达。
    expect(openTags(src, 'Page').some((tag) => tag.includes('width="wide"'))).toBe(true);
    expect(src).not.toMatch(/max-w-\[90rem\]/);
  });

  it('首页主栅格在大屏分成可收缩列', () => {
    // 340px 侧列与原型 E 的等分 Panel 栅格冲突，保留可收缩分列。
    expect(hasShrinkableDashboardGrid(readSource(HOME))).toBe(true);
  });

  it('个人卡片内容纵向排列并允许收缩', () => {
    expect(hasClassList(readSource(HOME), ['min-w-0', 'flex-col'])).toBe(true);
  });

  it('首页次级栅格在大屏分成可收缩列', () => {
    // 320px 侧列同样改成原型 E 的可收缩分列。
    expect(hasShrinkableDashboardGrid(readSource(HOME))).toBe(true);
  });

  it('首页主列必须能收缩，避免列被内容撑出视口', () => {
    expect(tagHasClasses(readSource(HOME), 'div', ['min-w-0'])).toBe(true);
  });

  it('首页入口链接本身可收缩', () => {
    expect(tagHasClasses(readSource(HOME), 'a', ['min-w-0'])).toBe(true);
  });

  it('首页卡片可收缩', () => {
    expect(hasClassList(readSource(HOME), ['min-w-0', 'rounded-lg', 'border'])).toBe(true);
  });

  it('首页搜索行在窄屏下换行', () => {
    expect(hasClassList(readSource(HOME), ['flex', 'min-w-0', 'flex-wrap'])).toBe(true);
  });

  it('搜索输入槽占据剩余宽度并允许收缩', () => {
    expect(hasClassList(readSource(HOME), ['min-w-0', 'flex-1'])).toBe(true);
  });

  it('搜索输入可收缩，且不用被禁止的 text-base', () => {
    const src = readSource(HOME);
    // text-base 触发 DS009；输入字号由 Input 阶梯承担，页面只保留可收缩。
    const shrinkable = tagHasClasses(src, 'Input', ['min-w-0']) || tagHasClasses(src, 'SearchInput', ['min-w-0']);
    expect(shrinkable).toBe(true);
    expect(src).not.toMatch(/\btext-base\b/);
  });

  it('搜索提交按钮不随输入框一起被压扁', () => {
    expect(tagHasClasses(readSource(HOME), 'Button', ['shrink-0'])).toBe(true);
  });

  it('搜索、收藏和最近题目的标题各有一处可收缩截断', () => {
    expect(countMatches(readSource(HOME), /className="min-w-0 flex-1 truncate"/g)).toBe(3);
  });

  it('比赛标题单独截断，隐藏标记不在标题字符串里', () => {
    const matched = tagWithClassesThen(
      readSource(HOME),
      'p',
      ['min-w-0', 'flex-1', 'truncate'],
      /^\s*\{c\.title \|\| '未命名比赛'\}/,
    );
    expect(matched).toBe(true);
  });

  it('已隐藏不得紧跟在被截断的比赛标题文本节点后面', () => {
    // 清单写「不带 truncate」与上一条「标题单独截断」矛盾，按意图只禁止标记落入标题节点。
    expect(readSource(HOME)).not.toMatch(/\{c\.title \|\| '未命名比赛'\}\s*\{c\.hidden === true/);
  });

  it('隐藏标记固定在标题外侧', () => {
    const src = readSource(HOME);
    const matched = tagWithClassesThen(src, 'Badge', ['shrink-0'], /^\s*已隐藏/)
      || tagWithClassesThen(src, 'span', ['shrink-0'], /^\s*已隐藏/);
    expect(matched).toBe(true);
  });

  it('首页公告行至少 44px 高并且整行可收缩', () => {
    expect(quotedHas(readSource(ANNOUNCE), ['min-h-11', 'min-w-0'])).toBe(true);
  });

  it('公告分类名限制在约 6rem 内截断', () => {
    // max-w-[6rem] 触发 DS004；6rem 的阶梯类是 max-w-24。
    expect(quotedHas(readSource(ANNOUNCE), ['max-w-24', 'min-w-0', 'shrink-0', 'truncate'])).toBe(true);
  });

  it('公告标题占据剩余宽度并截断', () => {
    expect(hasClassList(readSource(ANNOUNCE), ['min-w-0', 'flex-1', 'truncate'])).toBe(true);
  });

  it('首页去交文件是行内 44px 链接，整行本身不是链接', () => {
    const src = readSource(COLLECT);
    const link = tagWithClassesThen(src, 'a', ['inline-flex', 'min-h-11', 'shrink-0'], /^\s*去交文件/);
    expect(link).toBe(true);
    expect(src).not.toMatch(/<a\b[^>]*>\s*\{doc\.title\}/);
  });

  it('待交标题在段落里截断，标题本身不承担链接', () => {
    const matched = tagWithClassesThen(readSource(COLLECT), 'p', ['truncate'], /^\s*\{doc\.title\}/);
    expect(matched).toBe(true);
  });

  it('去交文件链接至少 44px 高', () => {
    const matched = tagWithClassesThen(readSource(COLLECT), 'a', ['min-h-11'], /^\s*去交文件/);
    expect(matched).toBe(true);
  });

  it('仪表盘按原型 E 用 gap-4 的大屏分列', () => {
    expect(hasShrinkableDashboardGrid(readSource(HOME))).toBe(true);
  });

  it('删除 StatCard，统计放在一个 Panel 里且最多四个一行', () => {
    const src = readSource(HOME);
    const row = panelBodies(src).some((body) => (
      /<Stat\b/.test(body) && classLists(body).some((tokens) => isStatRow(tokens))
    ));
    expect(row, '统计行要在同一 Panel 内同时带 grid-cols-2、md:grid-cols-4、md:divide-x、md:divide-line-subtle').toBe(true);
    expect(src).not.toMatch(/\bStatCard\b/);
  });

  it('删除 SectionShell，区块换成 Panel title', () => {
    const src = readSource(HOME);
    expect(src).not.toMatch(/\bSectionShell\b/);
    expect(openTags(src, 'Panel').some((tag) => tag.includes('title='))).toBe(true);
  });

  it('删除 Empty，空状态换成 EmptyState compact', () => {
    const src = readSource(HOME);
    expect(src).not.toMatch(/\bfunction Empty\b/);
    expect(src).not.toMatch(/<Empty\b/);
    expect(openTags(src, 'EmptyState').some((tag) => tag.includes('compact'))).toBe(true);
  });

  it('删除零引用的 routes/home-page.tsx', () => {
    expect(existsSync(DEAD_HOME)).toBe(false);
  });
});
