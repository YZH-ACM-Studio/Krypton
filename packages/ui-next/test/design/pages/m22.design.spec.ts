// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const EDITOR = 'src/pages/course/editor.tsx';
const ASSIGN = 'src/pages/course/assign.tsx';
const VIDEO_EDITOR = 'src/pages/course/video-editor.tsx';
const VIDEO_STATS = 'src/pages/course/video-stats.tsx';
const MINDMAP = 'src/pages/course/mindmap-editor.tsx';
const EXAM_SETTINGS = 'src/pages/course/course-exam-settings.tsx';

const LANE_FILES = [EDITOR, ASSIGN, VIDEO_EDITOR, VIDEO_STATS, MINDMAP, EXAM_SETTINGS] as const;

const TAB_LABELS = ['章节', '学生与可见性', '结业考试', '导图', '观看统计', '设置'] as const;

describe('m22 course editor', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 editor.tsx', () => {
    expectPageStructure(EDITOR, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 video-stats.tsx', () => {
    expectPageStructure(VIDEO_STATS, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 mindmap-editor.tsx', () => {
    expectPageStructure(MINDMAP, {
      widths: ['wide', 'full'],
      workspace: 'allowed',
      minPageHeaders: 1,
    });
  });

  it('课程编辑器换成宽页面、页头和六个页签', () => {
    const src = readSource(EDITOR);
    expect(src).toMatch(/<Page\s[^>]*width="wide"/);
    expect(src).toMatch(/<PageHeader\b/);
    expect(src).not.toMatch(/<Workspace(?=[\s>])/);
    expect(src).toMatch(/import\s*\{[^}]*\bPageTabs\b[^}]*\}\s*from\s*['"]@\/components\/ui\/page-tabs['"]/);
    expect(src).toContain('history.replaceState');
    for (const label of TAB_LABELS) {
      expect(src, label).toContain(label);
    }
    expect(src).toMatch(/\/course\/\$\{[^}]+\}\/videos/);
    expect(src).not.toMatch(/<TabsContent(?=[\s>/])/);
    expect(src).not.toMatch(/<TabsTrigger(?=[\s>/])/);
  });

  it('课程编辑器简介不带 col-span-full', () => {
    expect(readSource(EDITOR)).not.toContain('col-span-full');
  });

  it('课程观看名单不带 min-w-[48rem]', () => {
    expect(readSource(VIDEO_STATS)).not.toContain('min-w-[48rem]');
  });

  it('课程编辑器目录 SheetContent 不带 overflow-y-auto', () => {
    const tags = findOpenTags(readSource(EDITOR), 'SheetContent');
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag.text).not.toMatch(/overflow-y-auto/);
    }
  });

  it('课程编辑器删除满高写法', () => {
    const src = readSource(EDITOR);
    expect(src).not.toMatch(/100dvh/);
    expect(src).not.toMatch(/100vh/);
  });

  it('删除 krypton-course 装饰类引用', () => {
    for (const file of LANE_FILES) {
      expect(readSource(file), file).not.toMatch(/krypton-course-/);
    }
  });
});
