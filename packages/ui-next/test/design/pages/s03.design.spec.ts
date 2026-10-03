// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers';

const FILE = 'src/pages/problem-detail.tsx';
const COMPACT_TOOLBAR = ['h-10', 'border-b', 'border-line', 'bg-surface', 'px-2'] as const;
const DETAIL_GRID = ['grid', 'gap-6', 'lg:grid-cols-[minmax(0,1fr)_16rem]'] as const;
const RECORD_TABLE = ['min-w-[620px]', 'w-full', 'text-xs'] as const;

function pageSource(): string {
  return readSource(FILE);
}

function classTokenSets(text: string): Set<string>[] {
  const sets: Set<string>[] = [];
  for (const match of text.matchAll(/className="([^"]*)"/g)) {
    sets.push(new Set((match[1] ?? '').split(/\s+/).filter((token) => token.length > 0)));
  }
  return sets;
}

function hasClassTokens(text: string, tokens: readonly string[]): boolean {
  return classTokenSets(text).some((parts) => tokens.every((token) => parts.has(token)));
}

function ideModeBranch(src: string): string {
  const start = src.search(/if\s*\(\s*ideMode\s*\)/);
  if (start < 0) {
    return '';
  }
  const end = src.indexOf('\n  return (', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

describe('s03 problem detail', () => {
  it('门禁零违规', () => {
    expectGateClean([FILE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([FILE]);
  });

  it('页面结构 problem-detail.tsx', () => {
    expectPageStructure(FILE, {
      widths: ['wide'],
      workspace: 'required',
      minPageHeaders: 1,
    });
  });

  it('普通模式使用 Page width="wide"', () => {
    const pages = findOpenTags(pageSource(), 'Page');
    expect(pages.some((tag) => tag.text.includes('width="wide"'))).toBe(true);
  });

  it('题目详情宽表至少 620px', () => {
    expect(pageSource()).toMatch(/min-w-\[620px\]/);
  });

  it('题目详情宽表的 ScrollArea 在剩余高度内双向滚动', () => {
    const src = pageSource();
    const tableAt = src.indexOf('min-w-[620px]');
    expect(tableAt).toBeGreaterThan(-1);
    const areas = findOpenTags(src, 'ScrollArea').filter((tag) => {
      const at = src.indexOf(tag.text);
      return at >= 0 && at < tableAt && tag.text.includes('orientation="both"');
    });
    expect(areas.length).toBeGreaterThan(0);
    expect(areas.some((tag) => hasClassTokens(tag.text, ['min-h-0', 'flex-1']))).toBe(true);
  });

  it('题目页不把 companion 桥放在 flex-1 占位之后', () => {
    const src = pageSource();
    expect(src).toMatch(/<CompetitiveCompanionBridge\b/);
    expect(src).not.toMatch(/<div className="flex-1" \/>\s*\{showCompanion \? \(\s*<CompetitiveCompanionBridge/);
  });

  it('提交记录表至少 620px 宽且铺满', () => {
    expect(hasClassTokens(pageSource(), RECORD_TABLE)).toBe(true);
  });

  it('普通模式面包屑保留比赛、作业和题库', () => {
    const src = pageSource();
    const headers = findOpenTags(src, 'PageHeader');
    expect(headers.some((tag) => tag.text.includes('breadcrumb='))).toBe(true);
    expect(src).toMatch(/<Breadcrumb\b/);
    expect(src).toContain('比赛');
    expect(src).toContain('作业');
    expect(src).toContain('题库');
  });

  it('页头 meta 放难度、时间内存限制和通过提交数', () => {
    const src = pageSource();
    const headers = findOpenTags(src, 'PageHeader');
    expect(headers.some((tag) => tag.text.includes('meta='))).toBe(true);
    expect(src).toMatch(/<Difficulty\b/);
    expect(hasClassTokens(src, ['tabular'])).toBe(true);
    expect(src).toContain('时间');
    expect(src).toContain('内存');
    expect(src).toContain('通过');
    expect(src).toContain('提交');
  });

  it('页头 actions 放现有按钮', () => {
    const src = pageSource();
    const headers = findOpenTags(src, 'PageHeader');
    expect(headers.some((tag) => tag.text.includes('actions='))).toBe(true);
    expect(src).toContain('IDE 模式');
    expect(src).toContain('提交记录');
    expect(src).toContain('整题重测');
    expect(src).toContain('编辑');
    expect(src).toContain('归档');
  });

  it('普通模式主体是两栏网格', () => {
    expect(hasClassTokens(pageSource(), DETAIL_GRID)).toBe(true);
  });

  it('ide 模式根元素是带紧凑工具条的 Workspace', () => {
    const branch = ideModeBranch(pageSource());
    expect(branch).toMatch(/<Workspace\b/);
    expect(branch).toMatch(/<KryptonIDE\b/);
    const toolbars = findOpenTags(branch, 'Toolbar');
    expect(toolbars.length).toBeGreaterThan(0);
    expect(toolbars.some((tag) => hasClassTokens(tag.text, COMPACT_TOOLBAR))).toBe(true);
    const toolbarAt = branch.indexOf('<Toolbar');
    const toolbarEnd = branch.indexOf('</Toolbar>', toolbarAt);
    expect(toolbarEnd).toBeGreaterThan(toolbarAt);
    expect(branch.slice(toolbarAt, toolbarEnd)).toContain('truncate text-sm font-semibold text-fg');
  });

  it('提交记录结果使用紧凑 Verdict', () => {
    const verdicts = findOpenTags(pageSource(), 'Verdict').filter((tag) => (
      tag.text.includes('status=') && /\bcompact\b/.test(tag.text)
    ));
    expect(verdicts.length).toBeGreaterThan(0);
  });

  it('题面和样例仍由 programming-statement 渲染', () => {
    const src = pageSource();
    expect(src).toMatch(/<ProgrammingStatementView\b/);
    expect(src).toMatch(/\bstructuredStatementSamples\(/);
  });

  it('提交记录表仍由双向 ScrollArea 包裹', () => {
    const src = pageSource();
    const tableAt = src.indexOf('min-w-[620px]');
    expect(tableAt).toBeGreaterThan(-1);
    const before = src.slice(0, tableAt);
    expect(before).toMatch(/<ScrollArea\b[^>]+orientation="both"/);
  });
});
