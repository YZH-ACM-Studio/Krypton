// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/virtual-contest.tsx',
  'src/components/team-dialog.tsx',
  'src/components/contest-participation-field.tsx',
] as const;

const PAGE = 'src/pages/virtual-contest.tsx';
const TEAM = 'src/components/team-dialog.tsx';

// 纯外观且与新规范冲突，不写成断言：rounded-[28px]（DS012）、
// active:scale-[0.96]（按下缩放由 Button 负责）、重测说明的 max-w-prose /
// text-muted-foreground（§4.2、DS002）、剩余时间标题的 text-base（DS009）。
// §7.3 的 mobile="scroll" 与既有 ScrollArea orientation="both" 冲突，仍以双向滚动为准。

function classStrings(src: string): string[] {
  return [...src.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '');
}

function hasClass(value: string, name: string): boolean {
  const token = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${token}(?![\\w-])`).test(value);
}

function expectJoinedClasses(src: string, names: readonly string[]): void {
  const hit = classStrings(src).some((value) => names.every((name) => hasClass(value, name)));
  expect(hit, names.join(' ')).toBe(true);
}

function leftToken(value: string): string | undefined {
  return /(?<![\w-])(left-\d+)(?![\w-])/.exec(value)?.[1];
}

// 第二列 left 必须等于排名列宽度。两列都写 left-0 时，横向滚动会把排名盖住。
function expectSecondStickyColumnOffset(src: string): void {
  const sticky = classStrings(src).filter((value) => hasClass(value, 'sticky') && hasClass(value, 'bg-surface'));
  const rank = sticky.find((value) => hasClass(value, 'left-0'));
  const width = classStrings(src)
    .filter((value) => hasClass(value, 'sticky') && hasClass(value, 'left-0'))
    .map((value) => /(?<![\w-])w-(\d+)(?![\w-])/.exec(value)?.[1])
    .find((value): value is string => value !== undefined);
  const teamOffset = sticky
    .map((value) => leftToken(value))
    .find((value) => value !== undefined && value !== 'left-0');
  expect(teamOffset, 'second sticky column left offset').toBeTruthy();
  expect(rank, 'rank sticky left-0 bg-surface').toBeTruthy();
  expect(width, 'rank sticky column width').toBeDefined();
  expect(teamOffset).toBe(`left-${width ?? ''}`);
}

describe('s08 virtual contest, team dialog and participation field', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 virtual-contest.tsx', () => {
    expectPageStructure(PAGE, {
      widths: ['wide', 'full'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('对话框主体继续纵向滚动并挡住滚动链', () => {
    expectJoinedClasses(readSource(TEAM), ['overflow-y-auto', 'overscroll-contain']);
  });

  it('队伍对话框正文在自身内部纵向滚动', () => {
    expectJoinedClasses(readSource(TEAM), ['overflow-y-auto', 'overscroll-contain']);
  });

  it('队伍对话框不含 transition-all', () => {
    expect(readSource(TEAM)).not.toMatch(/(?<![\w-])transition-all(?![\w-])/);
  });

  it('入口操作在窄屏换行排列', () => {
    expectJoinedClasses(readSource(PAGE), ['flex', 'flex-wrap', 'items-center', 'gap-2']);
  });

  it('入口按钮允许文字换行', () => {
    expectJoinedClasses(readSource(PAGE), ['h-auto', 'whitespace-normal']);
  });

  it('剩余时间标题与状态可以换行', () => {
    expectJoinedClasses(readSource(PAGE), ['flex', 'flex-wrap', 'items-center', 'gap-2']);
  });

  it('题目标题在剩余空间里截断', () => {
    expectJoinedClasses(readSource(PAGE), ['min-w-0', 'truncate']);
  });

  it('题目标题旁的徽章不被压缩', () => {
    const matched = findOpenTags(readSource(PAGE), 'Badge').some((tag) => hasClass(tag.text, 'shrink-0'));
    expect(matched).toBe(true);
  });

  it('虚拟参赛正文列允许收缩', () => {
    expectJoinedClasses(readSource(PAGE), ['min-w-0', 'space-y-4']);
  });

  it('榜单卡片允许在窄屏收缩', () => {
    const src = readSource(PAGE);
    const matched = findOpenTags(src, 'Card').concat(findOpenTags(src, 'Panel')).some((tag) => (
      hasClass(tag.text, 'min-w-0')
    ));
    expect(matched).toBe(true);
  });

  it('榜单在全宽区域内双向滚动', () => {
    const matched = findOpenTags(readSource(PAGE), 'ScrollArea').some((tag) => (
      hasClass(tag.text, 'w-full') && tag.text.includes('orientation="both"')
    ));
    expect(matched).toBe(true);
  });

  it('榜单表格按内容撑开最小宽度', () => {
    expectJoinedClasses(readSource(PAGE), ['krypton-table', 'min-w-max']);
  });

  it('表头单元格至少 5rem 且不换行', () => {
    expectJoinedClasses(readSource(PAGE), ['min-w-20', 'whitespace-nowrap']);
  });

  it('另一类表头保留换行且至少 5rem', () => {
    expectJoinedClasses(readSource(PAGE), ['min-w-20', 'whitespace-pre-line']);
  });

  it('成绩列至少 6rem 且不换行', () => {
    expectJoinedClasses(readSource(PAGE), ['min-w-24', 'whitespace-nowrap']);
  });

  it('虚拟榜单单元格与 S07 相同并按 §7.3', () => {
    const src = readSource(PAGE);
    expectJoinedClasses(src, ['bg-success-soft', 'text-success-fg']);
    expectJoinedClasses(src, ['bg-success', 'text-on-success']);
    expectJoinedClasses(src, ['bg-danger-soft', 'text-danger-fg']);
    expectJoinedClasses(src, ['bg-info-soft', 'text-info-fg']);
    expectJoinedClasses(src, ['h-12', 'text-center', 'tabular', 'border-l', 'border-line-subtle']);
    expectSecondStickyColumnOffset(src);
  });

  it('虚拟榜单第二列的 left 偏移等于排名列宽度', () => {
    expectSecondStickyColumnOffset(readSource(PAGE));
  });

  it('队伍对话框使用 Dialog 并保留 markDialogSlot 与字段结构', () => {
    const src = readSource(TEAM);
    expect(src).toMatch(/from '@\/components\/ui\/dialog'/);
    expect(src).toMatch(/<DialogContent\b/);
    expect(src).toMatch(/<DialogHeader\b/);
    expect(src).toMatch(/<DialogTitle\b/);
    expect(src).toMatch(/<DialogDescription\b/);
    expect(src).toMatch(/<DialogBody\b/);
    expect(src).toMatch(/<DialogFooter\b/);
    expect(src).toContain("markDialogSlot(TeamDialogBody, 'body')");
    expect(src).toContain("markDialogSlot(TeamDialogFooter, 'footer')");
    expect(src).toMatch(/export function TeamDialogField\b/);
    expect(src).toContain('htmlFor={htmlFor}');
  });
});
