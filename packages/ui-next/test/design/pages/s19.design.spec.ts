// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers';

const LANE_FILES = [
  'src/pages/mindmap/index.tsx',
  'src/pages/mindmap/canvas.tsx',
  'src/pages/mindmap/outline.tsx',
  'src/pages/mindmap/inspector.tsx',
] as const;

const PAGE = 'src/pages/mindmap/index.tsx';
const CANVAS = 'src/pages/mindmap/canvas.tsx';
const OUTLINE = 'src/pages/mindmap/outline.tsx';
const INSPECTOR = 'src/pages/mindmap/inspector.tsx';

const WORKSPACE_ROOT = ['flex', 'w-full', 'min-w-0', 'overflow-hidden'] as const;
const COMPACT_TOOLBAR = ['h-10', 'border-b', 'border-line', 'bg-surface', 'px-2'] as const;
const SIDEBAR = ['bg-surface', 'border-l', 'border-line'] as const;
const NODE_SURFACE = ['bg-surface', 'border-line'] as const;
const TITLE_TOKENS = ['min-w-0', 'truncate', 'text-sm', 'font-semibold', 'text-fg'] as const;
const COLOR_LITERAL = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])|\b(?:rgba?|hsla?|oklch)\(/;
const SELECT_SIZE_SM = /\bsize=(?:"sm"|'sm'|\{["']sm["']\})/;

function classLists(source: string): string[][] {
  const lists: string[][] = [];
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    lists.push((match[1] ?? '').split(/\s+/).filter((token) => token.length > 0));
  }
  return lists;
}

function hasClassTokens(source: string, tokens: readonly string[]): boolean {
  return classLists(source).some((list) => tokens.every((token) => list.includes(token)));
}

function countClassLists(source: string, tokens: readonly string[]): number {
  return classLists(source).filter((list) => tokens.every((token) => list.includes(token))).length;
}

function toolbarBlock(source: string, openText: string): string {
  const at = source.indexOf(openText);
  if (at < 0) {
    return '';
  }
  const close = source.indexOf('</Toolbar>', at + openText.length);
  return close < 0 ? '' : source.slice(at, close);
}

describe('s19 knowledge mindmap', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 index.tsx', () => {
    expectPageStructure(PAGE, {
      widths: [],
      workspace: 'required',
      minPageHeaders: 0,
    });
  });

  it('公开导图不得再用固定 34rem 最小高度', () => {
    expect(readSource(PAGE)).not.toMatch(/min-h-\[34rem\]/);
  });

  it('公开导图画布不得用 top 42% 锚定', () => {
    expect(readSource(PAGE)).not.toMatch(/top-\[42%\]/);
  });

  it('公开知识导图工作区根带 flex w-full min-w-0 overflow-hidden', () => {
    const tags = findOpenTags(readSource(PAGE), 'Workspace');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((tag) => hasClassTokens(tag.text, WORKSPACE_ROOT))).toBe(true);
  });

  it('公开导图工作区不手写 100dvh，高度交给 Workspace', () => {
    const src = readSource(PAGE);
    // h-[calc(100dvh-…)] 与 min-h-[min(34rem,calc(…))] 触发 DS004，结构规则要求删掉视口高度计算。
    expect(src).toMatch(/<Workspace\b/);
    expect(src).not.toMatch(/100dvh|100vh/);
  });

  it('知识导图大纲填满所在栏并形成纵向滚动上下文', () => {
    expect(hasClassTokens(readSource(OUTLINE), ['h-full', 'min-h-0', 'flex-col'])).toBe(true);
  });

  it('知识导图检查器至少两层填满父级并可收缩', () => {
    expect(countClassLists(readSource(INSPECTOR), ['h-full', 'min-h-0'])).toBeGreaterThanOrEqual(2);
  });

  it('题目搜索结果不得绝对定位到输入框下方', () => {
    expect(readSource(INSPECTOR)).not.toMatch(/absolute inset-x-0 top-\[calc\(100%\+4px\)\]/);
  });

  it('节点折叠按钮点击目标为 40px', () => {
    const src = readSource(CANVAS);
    const tags = [...findOpenTags(src, 'button'), ...findOpenTags(src, 'Button')];
    const toggle = tags.filter((tag) => tag.text.includes('aria-label={data.collapsed'));
    expect(toggle.length).toBeGreaterThan(0);
    expect(toggle.some((tag) => hasClassTokens(tag.text, ['size-10']))).toBe(true);
  });

  it('原型 D 工作区使用紧凑 Toolbar，长标题不把切换器挤出 40px', () => {
    const src = readSource(PAGE);
    const toolbars = findOpenTags(src, 'Toolbar');
    expect(toolbars.length).toBeGreaterThan(0);
    const block = toolbars
      .map((tag) => toolbarBlock(src, tag.text))
      .find((text) => text.includes('ariaLabel="切换知识导图"'));
    expect(block).toBeDefined();
    const bar = block ?? '';
    const open = findOpenTags(bar, 'Toolbar')[0];
    expect(open).toBeDefined();
    // Toolbar 默认 flex-wrap，SimpleSelect 默认 md；两者都会让长标题把切换器挤出 h-10。
    const tokens = classLists(bar).find((list) => COMPACT_TOOLBAR.every((token) => list.includes(token)));
    expect(tokens).toBeDefined();
    expect(tokens?.includes('flex-nowrap')).toBe(true);
    expect(tokens?.includes('flex-wrap')).toBe(false);
    const children = bar.slice(open?.text.length ?? 0);
    expect(children.trimStart().startsWith('<span ')).toBe(true);
    const title = findOpenTags(children, 'span')[0];
    expect(hasClassTokens(title?.text ?? '', TITLE_TOKENS)).toBe(true);
    const switchers = findOpenTags(bar, 'SimpleSelect').filter((tag) => tag.text.includes('ariaLabel="切换知识导图"'));
    expect(switchers.length).toBeGreaterThan(0);
    expect(switchers.every((tag) => SELECT_SIZE_SM.test(tag.text))).toBe(true);
  });

  it('删除 difficultyStyle，难度一律用 Difficulty', () => {
    for (const file of LANE_FILES) {
      expect(readSource(file)).not.toMatch(/\bdifficultyStyle\b/);
    }
    const tags = findOpenTags(readSource(PAGE), 'Difficulty');
    expect(tags.some((tag) => tag.text.includes('level='))).toBe(true);
  });

  it('画布节点底色和边框改读 surface 与 line token', () => {
    const src = readSource(CANVAS);
    const classOk = hasClassTokens(src, NODE_SURFACE);
    const tokenOk = src.includes("readToken('--surface'") && src.includes("readToken('--line'");
    expect(classOk || tokenOk).toBe(true);
    const lines = src.split('\n');
    let sawLiteral = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (!COLOR_LITERAL.test(line)) {
        continue;
      }
      sawLiteral = true;
      const previous = index > 0 ? lines[index - 1] ?? '' : '';
      const allowed = line.includes('ds-allow DS003') || previous.includes('ds-allow DS003');
      expect(allowed).toBe(true);
    }
    if (sawLiteral) {
      expect(src).toMatch(/\breadToken\(/);
    }
  });

  it('侧栏面板使用 bg-surface border-l border-line', () => {
    expect(hasClassTokens(readSource(PAGE), SIDEBAR)).toBe(true);
  });
});
