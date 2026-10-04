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
  'src/pages/domain-permission-workspace.tsx',
  'src/components/domain-user-search.tsx',
] as const;

const WORKSPACE = 'src/pages/domain-permission-workspace.tsx';

const SCROLL_MOBILE = /mobile=(?:"scroll"|'scroll'|\{["']scroll["']\})/;
const CHECKBOX_SM = /\bsize=(?:"sm"|'sm'|\{["']sm["']\})/;

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

function tagClassValues(tag: string): string[] {
  const values: string[] = [];
  for (const match of tag.matchAll(/className="([^"]*)"/g)) {
    values.push(match[1] ?? '');
  }
  for (const match of tag.matchAll(/className=\{cn\(([\s\S]*?)\)\}/g)) {
    values.push(...classStrings(match[1] ?? ''));
  }
  return values;
}

const DATA_TABLE = 'src/components/ui/data-table.tsx';

// DESIGN §4.6：overflow-x-auto 会把 overflow-y 算成 auto。sticky 只相对这个滚动盒，
// 盒子本身没有高度上限时，长表跟着页面走，表头不会吸顶。
const STICKY_HEADER_CLASS = /stickyHeader\s*&&\s*['"]sticky top-0/;

function pageOptsScrollStickyDataTable(source: string): boolean {
  return findOpenTags(source, 'DataTable').some((tag) => (
    SCROLL_MOBILE.test(tag.text)
    && /\bstickyHeader\b/.test(tag.text)
    && !/stickyHeader=\{false\}/.test(tag.text)
  ));
}

function skipJsxTagEnd(source: string, openAt: number): { end: number; selfClosing: boolean } | null {
  let quote = '';
  let depth = 0;
  for (let index = openAt; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote !== '') {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (char === '>' && depth === 0) {
      return { end: index, selfClosing: source[index - 1] === '/' };
    }
  }
  return null;
}

function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || char === '/' || /\s/.test(char);
}

function elementInner(source: string, openAt: number, tagName: string): string | null {
  const opened = skipJsxTagEnd(source, openAt);
  if (opened === null || opened.selfClosing) return null;
  let depth = 1;
  let index = opened.end + 1;
  while (index < source.length) {
    const next = source.indexOf('<', index);
    if (next < 0) return null;
    const closeNeedle = `</${tagName}`;
    const openNeedle = `<${tagName}`;
    if (source.startsWith(closeNeedle, next) && isTagBoundary(source[next + closeNeedle.length])) {
      depth -= 1;
      if (depth === 0) return source.slice(opened.end + 1, next);
      const closeEnd = source.indexOf('>', next);
      index = closeEnd < 0 ? next + 1 : closeEnd + 1;
      continue;
    }
    if (source.startsWith(openNeedle, next) && isTagBoundary(source[next + openNeedle.length])) {
      const nested = skipJsxTagEnd(source, next);
      if (nested === null) return null;
      if (!nested.selfClosing) depth += 1;
      index = nested.end + 1;
      continue;
    }
    index = next + 1;
  }
  return null;
}

function horizontalScrollTrapsSticky(source: string): string | null {
  const wrappers = findOpenTags(source, 'div').filter((tag) => (
    tagClassValues(tag.text).some((value) => hasClass(value, 'overflow-x-auto'))
  ));
  for (const wrapper of wrappers) {
    const openAt = source.indexOf(wrapper.text);
    if (openAt < 0) {
      return 'data-table.tsx 的 overflow-x-auto 容器没有对上开标签';
    }
    const inner = elementInner(source, openAt, 'div');
    if (inner === null || !STICKY_HEADER_CLASS.test(inner)) continue;
    const tokens = tagClassValues(wrapper.text).flatMap((value) => value.split(/\s+/).filter((token) => token.length > 0));
    const boundsHeight = tokens.some((token) => token === 'h-full' || token.startsWith('max-h-'))
      || (tokens.includes('flex-1') && tokens.includes('min-h-0'));
    if (!boundsHeight) {
      return 'data-table.tsx 把 sticky 表头放在无高度上限的 overflow-x-auto 里，长表随页面滚动时表头不吸顶';
    }
  }
  const stickyApplied = STICKY_HEADER_CLASS.test(source);
  if (!stickyApplied) {
    return 'data-table.tsx 的 stickyHeader 没有给表头加上 sticky top-0';
  }
  return null;
}

function usesStickyTable(source: string): boolean {
  if (findOpenTags(source, 'Table').length === 0) {
    return false;
  }
  const headers = [...findOpenTags(source, 'TableHeader'), ...findOpenTags(source, 'TableHead')];
  return headers.some((tag) => tagClassValues(tag.text).some((value) => hasClass(value, 'sticky')));
}

describe('m06 domain permissions and user search', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 domain-permission-workspace.tsx', () => {
    expectPageStructure(WORKSPACE, {
      widths: ['wide'],
      workspace: 'allowed',
      minPageHeaders: 0,
    });
  });

  it('宽屏下角色列表与权限详情并排，左栏 17rem，右栏占满剩余宽度', () => {
    expectJoinedClasses(readSource(WORKSPACE), ['lg:grid-cols-[17rem_minmax(0,1fr)]']);
  });

  it('窄屏用顶部分隔的角色选择器，lg 及以上隐藏', () => {
    expectJoinedClasses(readSource(WORKSPACE), ['border-b', 'p-4', 'lg:hidden']);
  });

  it('工作区不得用 transition-all 动画宽屏分栏切换', () => {
    expect(readSource(WORKSPACE)).not.toMatch(/(?<![\w-])transition-all(?![\w-])/);
  });

  it('未保存草稿的操作条贴在视口底部', () => {
    expectJoinedClasses(readSource(WORKSPACE), ['sticky', 'bottom-2']);
  });

  it('权限矩阵是 DataTable mobile="scroll" 或 Table，且表头 sticky', () => {
    const page = readSource(WORKSPACE);
    const problems: string[] = [];
    const dataTablePath = pageOptsScrollStickyDataTable(page);
    const tablePath = usesStickyTable(page);
    if (!dataTablePath && !tablePath) {
      problems.push('页面没有 mobile="scroll" 且 stickyHeader 的 DataTable，也没有表头 sticky 的 Table');
    }
    // DataTable 这条路是否吸顶由组件里的 overflow 祖先决定，不能只看页面上的 stickyHeader。
    if (dataTablePath || !tablePath) {
      const trapped = horizontalScrollTrapsSticky(readSource(DATA_TABLE));
      if (trapped !== null) problems.push(trapped);
    }
    expect(problems).toEqual([]);
  });

  it('勾选单元格用 Checkbox size="sm"', () => {
    const tags = findOpenTags(readSource(WORKSPACE), 'Checkbox');
    expect(tags.length).toBeGreaterThan(0);
    const missing = tags.filter((tag) => !CHECKBOX_SM.test(tag.text)).map((tag) => tag.text);
    expect(missing).toEqual([]);
  });

  it('删除 calc(100dvh…) 写法', () => {
    expect(readSource(WORKSPACE)).not.toMatch(/calc\(100dvh/);
  });
});
