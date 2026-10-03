// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/problem-set-roster.tsx',
  'src/components/practice-roster.tsx',
  'src/pages/homework.tsx',
] as const;

const ROSTER_PAGE = 'src/pages/problem-set-roster.tsx';
const ROSTER = 'src/components/practice-roster.tsx';
const HOMEWORK = 'src/pages/homework.tsx';

/** Same open tag, either attribute order. `[^>]+` stays inside one tag. */
const SCROLL_MAX_H_28_BOTH = /<ScrollArea\b[^>]+\bmax-h-\[28rem\][^>]+\borientation="both"|<ScrollArea\b[^>]+\borientation="both"[^>]+\bmax-h-\[28rem\]/;
const PAGE_WIDTH_WIDE = /<Page\b[^>]+\bwidth="wide"/;

/** Root of the roster page. Card class names elsewhere in the file do not count. */
function rosterPageRoot(source: string): string {
  const match = /<Page\b[^>]*>/.exec(source);
  expect(match, 'roster page root <Page>').not.toBeNull();
  return match?.[0] ?? '';
}

describe('s10 problem-set roster, practice roster and homework', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 problem-set-roster.tsx', () => {
    expectPageStructure(ROSTER_PAGE, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 homework.tsx', () => {
    expectPageStructure(HOMEWORK, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('参加名单表格限制在 28rem 高度内并双向滚动', () => {
    expect(readSource(ROSTER)).toMatch(SCROLL_MAX_H_28_BOTH);
  });

  it('参加名单表格至少 640px 宽，避免列被压扁', () => {
    expect(readSource(ROSTER)).toMatch(/min-w-\[640px\]/);
  });

  it('题集参加名单页通过 Page width 声明宽度，不靠捕获根节点 className', () => {
    expect(readSource(ROSTER_PAGE)).toMatch(PAGE_WIDTH_WIDE);
  });

  it('名单页用 Page 表达结构，不靠导出函数位置提取类名', () => {
    const src = readSource(ROSTER_PAGE);
    expect(src).toMatch(/export function ProblemSetRosterPage\b/);
    expect(src).toMatch(PAGE_WIDTH_WIDE);
  });

  it('名单页根节点用 Page width="wide" 铺满内容区，而不是静态 class 捕获', () => {
    const root = rosterPageRoot(readSource(ROSTER_PAGE));
    expect(root).toMatch(/\bw-full\b/);
    expect(root).toMatch(PAGE_WIDTH_WIDE);
  });

  it('题集参加名单页根节点占满 AppShell 内容宽度', () => {
    expect(rosterPageRoot(readSource(ROSTER_PAGE))).toMatch(/\bw-full\b/);
  });

  it('名单页根节点可以在 flex 父级中收缩，避免撑破内容区', () => {
    expect(rosterPageRoot(readSource(ROSTER_PAGE))).toMatch(/\bmin-w-0\b/);
  });

  it('problem-set-roster-layout：名单页不得用自动水平外边距收成居中窄栏', () => {
    expect(readSource(ROSTER_PAGE)).not.toMatch(/\bmx-auto\b/);
  });

  it('名单页不得用 max-w-7xl 限制整页宽度', () => {
    expect(readSource(ROSTER_PAGE)).not.toMatch(/\bmax-w-7xl\b/);
  });

  it('名单页不得用 90rem 任意最大宽度限制整页', () => {
    expect(readSource(ROSTER_PAGE)).not.toMatch(/max-w-\[90rem\]/);
  });

  it('题集参加名单页的根容器和名单卡片占满可用宽度，不能被挤窄', () => {
    const src = readSource(ROSTER_PAGE);
    expect(rosterPageRoot(src)).toMatch(/w-full min-w-0/);
    expect(src).toMatch(/<PracticeRosterCard\b[\s\S]+?w-full min-w-0/);
  });

  it('problem-set-roster：名单页不得用自动水平外边距收成居中窄栏', () => {
    expect(readSource(ROSTER_PAGE)).not.toMatch(/\bmx-auto\b/);
  });

  it('名单页不得用任意 max-width 限制整页宽度', () => {
    expect(readSource(ROSTER_PAGE)).not.toMatch(/max-w-\[/);
  });

  it('成员名单表的滚动区最高 28rem，超出后在卡片内滚动', () => {
    expect(readSource(ROSTER)).toMatch(/max-h-\[28rem\]/);
  });

  it('成员表至少 640px 宽，窄容器里横向滚动而不是挤列', () => {
    expect(readSource(ROSTER)).toMatch(/min-w-\[640px\]/);
  });

  it('训练名单成员表至少 640px 宽，并位于双向滚动区之内', () => {
    expect(readSource(ROSTER)).toMatch(/<ScrollArea\b[^>]+\borientation="both"[\s\S]+?min-w-\[640px\]/);
  });

  it('名单表单元格不换行，列宽由内容撑开后横向滚动', () => {
    expect(readSource(ROSTER)).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('每题完成人数矩阵的题目标题列在横向滚动时钉在左侧', () => {
    expect(readSource(ROSTER)).toMatch(/sticky left-0/);
  });

  it('名单矩阵保留 ScrollArea orientation="both" 与 sticky left-0 首列', () => {
    const src = readSource(ROSTER);
    expect(src).toMatch(
      /<ScrollArea\b[^>]+\borientation="both"[^>]*>(?:(?!<\/ScrollArea>)[\s\S])+?sticky left-0/,
    );
  });

  it('practiceRosterCard 换成 Panel', () => {
    const src = readSource(ROSTER);
    expect(src).toMatch(/export function PracticeRosterCard\b/);
    expect(src).toMatch(/<Panel\b/);
    expect(src).not.toMatch(/<(?:Card|CardHeader|CardContent|CardTitle)\b/);
  });
});
