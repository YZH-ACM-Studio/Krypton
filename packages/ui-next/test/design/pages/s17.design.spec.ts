// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const UI = 'src/pages/course/ui.tsx';
const LIST = 'src/pages/course/list.tsx';
const EXAM_CARD = 'src/pages/course/course-exam-card.tsx';
const CHAPTER_LINKS = 'src/pages/course/chapter-links.tsx';

const LANE_FILES = [UI, LIST, EXAM_CARD, CHAPTER_LINKS] as const;

// legacy-intents T01–T04 里，源文件属于本 lane 的只有 list.tsx。
// ui.tsx、course-exam-card.tsx、chapter-links.tsx 没有意图条目。

const EXPORTS = [
  'courseMarkHue',
  'courseMarkGlyph',
  'CourseMark',
  'CourseProgressRing',
  'CourseProgressBar',
  'CourseSectionHeader',
  'useSpotlight',
  'riseStyle',
] as const;

const MARK_PROPS = ['seed', 'title', 'className', 'glyphClassName'] as const;
const RING_PROPS = ['value', 'size', 'thickness', 'label', 'className'] as const;
const BAR_PROPS = ['value', 'label', 'className', 'trackClassName'] as const;
const HEADER_PROPS = ['id', 'title', 'description', 'count', 'action', 'className', 'level'] as const;

// Panel 头部（src/components/ui/panel.tsx）的三处 class。
const PANEL_HEADER = 'flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-2.5';
const PANEL_TITLE = 'text-sm font-semibold text-fg';
const PANEL_DESCRIPTION = 'text-xs text-fg-subtle';

const COURSE_CARD = 'rounded-lg border border-line bg-surface p-4 shadow-xs';
const MARK_CLASS = 'bg-brand-soft text-brand-fg rounded-lg';

function functionBody(source: string, name: string): string {
  const pattern = new RegExp(`function ${name}\\b`);
  const match = pattern.exec(source);
  if (match === null || match.index === undefined) {
    return '';
  }
  const rest = source.slice(match.index);
  const next = rest.slice(match[0].length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, match[0].length + next);
}

function returnRootTag(body: string): string {
  const match = /return\s*\(\s*(<[\s\S]*?>)/.exec(body);
  return match?.[1] ?? '';
}

function coursePageRoot(): string {
  return returnRootTag(functionBody(readSource(LIST), 'CoursePage'));
}

function staticRootClass(): string {
  const match = /className="([^"]*)"/.exec(coursePageRoot());
  return match?.[1] ?? '';
}

function expectProps(body: string, props: readonly string[]): void {
  expect(body.length).toBeGreaterThan(0);
  for (const prop of props) {
    expect(body).toMatch(new RegExp(`\\b${prop}\\b`));
  }
}

function buttonBlocks(source: string): string[] {
  const blocks: string[] = [];
  const open = /<Button\b/g;
  for (let match = open.exec(source); match !== null; match = open.exec(source)) {
    const start = match.index;
    const close = source.indexOf('</Button>', start);
    if (close < 0) break;
    blocks.push(source.slice(start, close + '</Button>'.length));
    open.lastIndex = close + '</Button>'.length;
  }
  return blocks;
}

function isCreatePrimary(button: string): boolean {
  return button.includes('新建课程') && button.includes('variant="primary"');
}

describe('s17 course shared UI, course list and exam card', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('新建课程相关的 variant="primary" 只出现 1 次', () => {
    const src = readSource(LIST);
    const createPrimary = buttonBlocks(src).filter(isCreatePrimary);
    expect(createPrimary.length).toBe(1);
    const emptyAt = src.indexOf('<EmptyState');
    expect(emptyAt).toBeGreaterThanOrEqual(0);
    const only = createPrimary[0] ?? '';
    expect(src.indexOf(only)).toBeGreaterThanOrEqual(0);
    expect(src.indexOf(only)).toBeLessThan(emptyAt);
    expect(src.slice(emptyAt).includes('新建课程')).toBe(false);
  });

  it('页面结构 list.tsx', () => {
    expectPageStructure(LIST, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('list.tsx 的根有静态 className，用来铺满应用壳内容区', () => {
    const classes = staticRootClass().split(/\s+/).filter((token) => token.length > 0);
    expect(classes).toContain('w-full');
    expect(classes).toContain('min-w-0');
  });

  it('list.tsx 的根带 w-full', () => {
    const root = coursePageRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).toMatch(/\bw-full\b/);
  });

  it('list.tsx 的根带 min-w-0', () => {
    const root = coursePageRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).toMatch(/\bmin-w-0\b/);
  });

  it('list.tsx 的根不带 mx-auto', () => {
    const root = coursePageRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).not.toMatch(/\bmx-auto\b/);
  });

  it('list.tsx 的根不带 max-w-', () => {
    const root = coursePageRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).not.toMatch(/max-w-/);
  });

  it('课程列表不带 max-w-[76rem]', () => {
    expect(readSource(LIST)).not.toContain('max-w-[76rem]');
  });

  it('课程共享组件保留既有导出名和 props', () => {
    const src = readSource(UI);
    for (const name of EXPORTS) {
      expect(src).toMatch(new RegExp(`export function ${name}\\b`));
    }
    expectProps(functionBody(src, 'CourseMark'), MARK_PROPS);
    expectProps(functionBody(src, 'CourseProgressRing'), RING_PROPS);
    expectProps(functionBody(src, 'CourseProgressBar'), BAR_PROPS);
    expectProps(functionBody(src, 'CourseSectionHeader'), HEADER_PROPS);
  });

  it('courseMark 使用统一的品牌色，不再按课程哈希取色', () => {
    const src = readSource(UI);
    const mark = functionBody(src, 'CourseMark');
    expect(mark).toContain(MARK_CLASS);
    expect(mark).not.toContain('--mark-h');
    expect(mark).not.toContain('courseMarkHue');
    expect(mark).not.toContain('rounded-xl');
    expect(src).not.toContain('MARK_HUES');
    expect(src).not.toMatch(/function stableHash\b/);
    expect(src).not.toContain('--mark-h');
  });

  it('courseSectionHeader 与 Panel 头部一致', () => {
    const header = functionBody(readSource(UI), 'CourseSectionHeader');
    expect(header).toContain(PANEL_HEADER);
    expect(header).toContain(PANEL_TITLE);
    expect(header).toContain(PANEL_DESCRIPTION);
    expect(header).not.toContain('krypton-course-section');
    expect(header).not.toContain('w-[3px]');
  });

  it('courseCard 使用表面卡片，悬停只加深边框和阴影', () => {
    const card = functionBody(readSource(LIST), 'CourseCard');
    expect(card).toContain(COURSE_CARD);
    expect(card).toContain('hover:border-line-strong');
    expect(card).toContain('hover:shadow-sm');
    expect(card).not.toContain('hover:bg-muted/40');
  });
});
