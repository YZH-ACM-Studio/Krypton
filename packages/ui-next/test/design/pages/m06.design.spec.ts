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

function pageOptsScrollStickyDataTable(source: string): boolean {
  return findOpenTags(source, 'DataTable').some((tag) => (
    SCROLL_MOBILE.test(tag.text)
    && /\bstickyHeader\b/.test(tag.text)
    && !/stickyHeader=\{false\}/.test(tag.text)
  ));
}

function permissionMatrixContainer(source: string): string {
  const hit = findOpenTags(source, 'div').find((tag) => {
    const at = source.indexOf(tag.text);
    if (at < 0) return false;
    const after = source.slice(at + tag.text.length);
    const tableAt = after.search(/<Table(?=[\s>/])/);
    if (tableAt < 0) return false;
    if (after.slice(0, tableAt).trim() !== '') return false;
    const close = after.indexOf('</Table>', tableAt);
    if (close < 0) return false;
    return after.slice(tableAt, close).includes('权限');
  });
  if (hit === undefined) {
    throw new TypeError('权限矩阵 Table 没有外层容器');
  }
  return hit.text;
}

function quotedClassName(tag: string): string {
  const quoted = /className=(?:"([^"]*)"|'([^']*)')/.exec(tag);
  if (quoted !== null) return quoted[1] ?? quoted[2] ?? '';
  const expression = /className=\{([\s\S]*?)\}/.exec(tag);
  return expression?.[1] ?? '';
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
    expect(problems).toEqual([]);
    // sticky 只相对有界滚动祖先生效。容器必须自带高度上限，不能因表头已写 sticky 就跳过。
    const container = permissionMatrixContainer(page);
    const tokens = quotedClassName(container).split(/\s+/).filter((token) => token.length > 0);
    expect(tokens.some((token) => /(?:^|:)max-h-/.test(token))).toBe(true);
    expect(container.includes('!block') || container.includes('viewportClassName')).toBe(true);
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
