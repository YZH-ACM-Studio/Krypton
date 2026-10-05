// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/mindmap/admin.tsx';
const LANE_FILES = [PAGE] as const;

// 与新规范冲突，不按旧类名保留：
// 面板 rounded / bg-card / shadow-sm 改成 border-line 分隔（原型 D 不用间隙加卡片，bg-card 触发 DS002）。
// 工作区根的 h-[calc(100dvh-…)] 删除（DS004）；高度交给 Workspace，只保留 xl 才裁切。
// MiniTabs 的 h-11 删除（DESIGN §2.9 不允许 11 档）。
// 对话框按钮的 min-h-10 删除（§6.3 禁止用 className 覆盖按钮高度；高度只由 size 决定）。

const WORKSPACE_ROOT = ['flex', 'w-full', 'min-w-0', 'flex-col'] as const;
const COMPACT_TOOLBAR = ['h-10', 'border-b', 'border-line', 'bg-surface', 'px-2'] as const;
const TITLE_TOKENS = ['min-w-0', 'truncate', 'text-sm', 'font-semibold', 'text-fg'] as const;
const SIDE_PANEL = ['hidden', 'xl:flex', 'xl:flex-col'] as const;
const PANELS = ['outline', 'preview', 'inspector'] as const;
const SELECT_SIZE_SM = /\bsize=(?:"sm"|'sm'|\{\s*["']sm["']\s*\})/;

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

function quotedStrings(source: string): string[] {
  return [...source.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '');
}

function classTokens(source: string): string[] {
  return quotedStrings(source).flatMap((value) => value.split(/\s+/).filter((token) => token.length > 0));
}

function hasJoinedTokens(source: string, tokens: readonly string[]): boolean {
  return quotedStrings(source).some((value) => {
    const parts = value.split(/\s+/);
    return tokens.every((token) => parts.includes(token));
  });
}

function utilityRoot(token: string): string {
  const base = token.split(':').pop() ?? token;
  return base.split('/')[0] ?? base;
}

function hasUtilityPrefix(tokens: readonly string[], prefix: string): boolean {
  return tokens.some((token) => {
    const root = utilityRoot(token);
    return root === prefix || root.startsWith(`${prefix}-`) || root.startsWith(`${prefix}[`);
  });
}

function isCardChrome(token: string): boolean {
  const root = utilityRoot(token);
  if (root === 'bg-card') {
    return true;
  }
  if (root === 'shadow' || root.startsWith('shadow-') || root.startsWith('shadow[')) {
    return true;
  }
  return root === 'rounded' || root.startsWith('rounded-') || root.startsWith('rounded[');
}

function hasBorderLine(tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    const root = utilityRoot(token);
    return root === 'border-line' || root.startsWith('border-line-');
  });
}

function hasGap(tokens: readonly string[]): boolean {
  return hasUtilityPrefix(tokens, 'gap');
}

function workspaceTags(source: string): string[] {
  return findOpenTags(source, 'Workspace').map((tag) => tag.text);
}

function panelTags(source: string): string[] {
  return ['aside', 'section', 'div', 'main'].flatMap((tag) => findOpenTags(source, tag))
    .filter((tag) => tag.text.includes('data-mindmap-panel="'))
    .map((tag) => tag.text);
}

function toolbarBlock(source: string, openText: string): string {
  const at = source.indexOf(openText);
  if (at < 0) {
    return '';
  }
  const close = source.indexOf('</Toolbar>', at + openText.length);
  return close < 0 ? '' : source.slice(at, close);
}

function hasButtonHeightOverride(tag: string): boolean {
  return classTokens(tag).some((token) => /^(?:h|min-h|max-h)-/.test(utilityRoot(token)));
}

/** `sm:h-auto` 与 `h-10` 不同变体组，会同时留下；640px 以上栏高不再是 40px。 */
function heightUtilities(tokens: readonly string[]): string[] {
  return tokens.filter((token) => /^(?:h|min-h|max-h)-/.test(utilityRoot(token)));
}

function contentClassHasToken(tag: string, token: string): boolean {
  const quoted = /contentClassName="([^"]*)"/.exec(tag);
  if ((quoted?.[1] ?? '').split(/\s+/).some((part) => part.includes(token))) {
    return true;
  }
  const expr = /contentClassName=\{([\s\S]*?)\}/.exec(tag);
  return (expr?.[1] ?? '').includes(token);
}

describe('m19 mindmap administration', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 admin.tsx', () => {
    expectPageStructure(PAGE, {
      widths: [],
      workspace: 'required',
      minPageHeaders: 0,
    });
  });

  it('管理知识导图工作区根带 flex w-full min-w-0 flex-col', () => {
    const tags = workspaceTags(readSource(PAGE));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((tag) => hasJoinedTokens(tag, WORKSPACE_ROOT))).toBe(true);
  });

  it('管理知识导图工作区根不带圆角', () => {
    const tags = workspaceTags(readSource(PAGE));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => !hasUtilityPrefix(classTokens(tag), 'rounded'))).toBe(true);
  });

  it('管理知识导图工作区根不带边框', () => {
    const tags = workspaceTags(readSource(PAGE));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => !hasUtilityPrefix(classTokens(tag), 'border'))).toBe(true);
  });

  it('管理知识导图工作区根不带阴影', () => {
    const tags = workspaceTags(readSource(PAGE));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => !hasUtilityPrefix(classTokens(tag), 'shadow'))).toBe(true);
  });

  it('管理导图不手写 100dvh 或 100vh，高度交给 Workspace', () => {
    const src = readSource(PAGE);
    expect(src).toMatch(/<Workspace(?=[\s>])/);
    expect(src).not.toMatch(/100dvh|100vh/);
  });

  it('管理导图工作区只在 xl 裁切溢出', () => {
    const tags = workspaceTags(readSource(PAGE));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((tag) => classTokens(tag).includes('xl:overflow-hidden'))).toBe(true);
  });

  it('管理导图工作区根不带无条件 overflow-hidden', () => {
    const tags = workspaceTags(readSource(PAGE));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => !classTokens(tag).includes('overflow-hidden'))).toBe(true);
  });

  it('管理导图工作区不带不随视口缩小的 42rem 最小高度', () => {
    expect(readSource(PAGE)).not.toMatch(/42rem/);
  });

  it('管理导图页任何地方都不写死 42rem 最小高度', () => {
    expect(readSource(PAGE)).not.toMatch(/min-h-\[42rem\]/);
    expect(readSource(PAGE)).not.toMatch(/42rem/);
  });

  it('管理导图页不在 md 切成三列', () => {
    expect(readSource(PAGE)).not.toMatch(/md:grid-cols-3/);
  });

  it('管理知识导图面板用 border-line 分隔，不再是带间隙的圆角卡片', () => {
    const src = readSource(PAGE);
    const panels = panelTags(src);
    expect(panels.length).toBe(PANELS.length);
    for (const id of PANELS) {
      const tag = panels.find((text) => text.includes(`data-mindmap-panel="${id}"`)) ?? '';
      const tokens = classTokens(tag);
      expect(tag.length, id).toBeGreaterThan(0);
      expect(hasBorderLine(tokens), id).toBe(true);
      expect(tokens.some((token) => isCardChrome(token)), id).toBe(false);
    }
    const main = findOpenTags(src, 'main').find((tag) => tag.text.includes('aria-label="导图管理工作区"'));
    expect(main).toBeDefined();
    expect(hasGap(classTokens(main?.text ?? ''))).toBe(false);
  });

  it('窄屏下面板切换条钉在工作区顶部', () => {
    expect(hasJoinedTokens(readSource(PAGE), ['sticky', 'top-0'])).toBe(true);
  });

  it('移动面板切换只在小于 xl 时出现', () => {
    expect(hasJoinedTokens(readSource(PAGE), ['sticky', 'top-0', 'xl:hidden'])).toBe(true);
  });

  it('侧栏面板在小于 xl 时隐藏，xl 以上才纵向展开', () => {
    const panels = panelTags(readSource(PAGE));
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((tag) => hasJoinedTokens(tag, SIDE_PANEL))).toBe(true);
  });

  it('三栏工作区只在 xl 及以上变成多列网格', () => {
    expect(readSource(PAGE)).toMatch(/xl:grid-cols-/);
  });

  it('布局切换不得发生在 lg', () => {
    expect(readSource(PAGE)).not.toMatch(/\blg:(?:grid|flex|hidden)/);
  });

  it('钉住的移动切换条包含 MiniTabs', () => {
    const src = readSource(PAGE);
    const at = [...src.matchAll(/['"`]([^'"`]*)['"`]/g)].find((match) => {
      const parts = (match[1] ?? '').split(/\s+/);
      return ['sticky', 'top-0', 'xl:hidden'].every((token) => parts.includes(token));
    });
    expect(at?.index).toBeGreaterThanOrEqual(0);
    const window = src.slice(at?.index ?? 0, (at?.index ?? 0) + 800);
    expect(window).toContain('<MiniTabs');
  });

  it('移动切换条的 MiniTabs 不使用间距阶梯外的 h-11', () => {
    const tabs = findOpenTags(readSource(PAGE), 'MiniTabs');
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.some((tag) => classTokens(tag.text).includes('h-11'))).toBe(false);
  });

  it('新建节点对话框控件带 h-10', () => {
    const body = functionBody(readSource(PAGE), 'CreateNodeDialog');
    expect(body.length).toBeGreaterThan(0);
    const inputs = findOpenTags(body, 'Input');
    expect(inputs.some((tag) => classTokens(tag.text).includes('h-10'))).toBe(true);
  });

  it('新建节点对话框选项至少 40px 高', () => {
    const body = functionBody(readSource(PAGE), 'CreateNodeDialog');
    expect(body.length).toBeGreaterThan(0);
    const selects = findOpenTags(body, 'SimpleSelect');
    expect(selects.some((tag) => contentClassHasToken(tag.text, 'min-h-10'))).toBe(true);
  });

  it('新建节点对话框恰好两个按钮且不覆盖高度', () => {
    const body = functionBody(readSource(PAGE), 'CreateNodeDialog');
    expect(body.length).toBeGreaterThan(0);
    const buttons = findOpenTags(body, 'Button');
    expect(buttons.length).toBe(2);
    expect(buttons.some((tag) => hasButtonHeightOverride(tag.text))).toBe(false);
  });

  it('删除节点对话框恰好两个按钮且不覆盖高度', () => {
    const body = functionBody(readSource(PAGE), 'DeleteNodeDialog');
    expect(body.length).toBeGreaterThan(0);
    const buttons = findOpenTags(body, 'Button');
    expect(buttons.length).toBe(2);
    expect(buttons.some((tag) => hasButtonHeightOverride(tag.text))).toBe(false);
  });

  it('原型 D 工作区使用紧凑 Toolbar，标题在最左侧', () => {
    const src = readSource(PAGE);
    const toolbars = findOpenTags(src, 'Toolbar');
    expect(toolbars.length).toBeGreaterThan(0);
    const block = toolbars
      .map((tag) => toolbarBlock(src, tag.text))
      .find((text) => text.includes('导图管理')) ?? '';
    expect(block.length).toBeGreaterThan(0);
    const open = findOpenTags(block, 'Toolbar')[0];
    expect(open).toBeDefined();
    const lists = quotedStrings(open?.text ?? '').map((value) => value.split(/\s+/));
    const tokens = lists.find((list) => COMPACT_TOOLBAR.every((token) => list.includes(token)));
    expect(tokens).toBeDefined();
    expect(tokens?.includes('flex-nowrap')).toBe(true);
    expect(tokens?.includes('flex-wrap')).toBe(false);
    expect(block.includes('overflow-x-auto')).toBe(false);
    expect(block.includes('scrollbar-none')).toBe(false);
    expect(heightUtilities(tokens ?? [])).toEqual(['h-10']);
    const children = block.slice(open?.text.length ?? 0).trimStart();
    expect(children.startsWith('<span')).toBe(true);
    const title = findOpenTags(children, 'span')[0];
    expect(hasJoinedTokens(title?.text ?? '', TITLE_TOKENS)).toBe(true);
    const spanClose = children.indexOf('</span>');
    expect(spanClose).toBeGreaterThan(0);
    expect(children.slice(0, spanClose)).toContain('导图管理');
    const switchers = findOpenTags(block, 'SimpleSelect').filter((tag) => tag.text.includes('ariaLabel="切换知识导图"'));
    expect(switchers.length).toBeGreaterThan(0);
    expect(switchers.every((tag) => SELECT_SIZE_SM.test(tag.text))).toBe(true);
    const buttons = findOpenTags(block, 'Button');
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((tag) => SELECT_SIZE_SM.test(tag.text))).toBe(true);
  });

  it('保留大纲、预览和检查器的 data-mindmap-panel 钩子', () => {
    const src = readSource(PAGE);
    for (const id of PANELS) {
      expect(src.includes(`data-mindmap-panel="${id}"`), id).toBe(true);
    }
  });

  it('不新增重新同步按钮', () => {
    expect(readSource(PAGE).includes('重新同步')).toBe(false);
  });
});
