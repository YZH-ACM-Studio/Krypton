// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const ADMIN = 'src/pages/admin.tsx';
const STATS = 'src/pages/admin-stats.tsx';
const DROPBOX = 'src/pages/admin-dropbox.tsx';
const ECHART = 'src/components/ui/echart.tsx';
const LANE_FILES = [ADMIN, STATS, DROPBOX] as const;

// legacy-intents T01–T04 里，本 lane 只有 admin-stats.tsx 的 9 条。
// admin.tsx 和 admin-dropbox.tsx 没有意图条目。
// h-[280px] 触发 DS004；DESIGN §6.34 把图表任意高度收成 EChart 默认的 h-56。

const ADMIN_TITLES = ['域管理', '系统管理', '系统状态'] as const;
const CHART_SHELL = "cn('h-56 w-full min-w-0'";

function classNameValues(source: string): string[] {
  const values: string[] = [];
  let search = 0;
  while (search < source.length) {
    const at = source.indexOf('className=', search);
    if (at < 0) break;
    const cursor = at + 'className='.length;
    if (source.startsWith('"', cursor) || source.startsWith("'", cursor)) {
      const quote = source[cursor] ?? '"';
      const end = source.indexOf(quote, cursor + 1);
      if (end < 0) break;
      values.push(source.slice(cursor + 1, end));
      search = end + 1;
      continue;
    }
    if (source.startsWith('{`', cursor)) {
      const end = source.indexOf('`}', cursor + 2);
      if (end < 0) break;
      values.push(source.slice(cursor + 2, end));
      search = end + 2;
      continue;
    }
    if (source.startsWith('{"', cursor) || source.startsWith("{'", cursor)) {
      const quote = source[cursor + 1] ?? '"';
      const end = source.indexOf(quote, cursor + 2);
      if (end < 0) break;
      values.push(source.slice(cursor + 2, end));
      search = end + 1;
      continue;
    }
    if (source.startsWith('{cn(', cursor)) {
      const open = cursor + 3;
      const close = closeParen(source, open);
      if (close < 0) break;
      values.push(quotedText(source.slice(open + 1, close)));
      search = close + 1;
      continue;
    }
    search = cursor;
  }
  return values;
}

function closeParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function quotedText(source: string): string {
  const parts: string[] = [];
  for (const match of source.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return parts.join(' ');
}

function classTokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 0 && !token.includes('${')));
}

function expectTokens(source: string, tokens: readonly string[]): void {
  const found = classNameValues(source).some((value) => {
    const present = classTokens(value);
    return tokens.every((token) => present.has(token));
  });
  expect(found, tokens.join(' ')).toBe(true);
}

function wideSpanProblems(source: string, wide: string): string[] {
  const problems: string[] = [];
  let seen = 0;
  for (const value of classNameValues(source)) {
    const tokens = classTokens(value);
    if (!tokens.has(wide)) continue;
    seen += 1;
    if (!tokens.has('col-span-12')) problems.push(value);
  }
  if (seen === 0) problems.push(`没有 ${wide}`);
  return problems;
}

function stringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([\s\S]*?)\2/g)) {
    const name = match[1];
    const value = match[3];
    if (name && value !== undefined && !value.includes('${')) constants.set(name, value);
  }
  return constants;
}

function attributeExpression(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([\\s\\S]*?)\\})`).exec(tag);
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

function classText(source: string, expression: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(expression)) return stringConstants(source).get(expression) ?? '';
  const quoted = [...expression.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
  return quoted.length > 0 ? quoted.join(' ') : expression;
}

function heightTokens(value: string): string[] {
  return [...classTokens(value)].filter((token) => /^(?:min-|max-)?h-/.test(token));
}

function chartHeightProblems(source: string): string[] {
  const problems: string[] = [];
  for (const tag of findOpenTags(source, 'EChart')) {
    for (const name of ['className', 'heightClassName'] as const) {
      const expression = attributeExpression(tag.text, name);
      if (expression === null || expression.length === 0) continue;
      const unexpected = heightTokens(classText(source, expression)).filter((token) => token !== 'h-56');
      for (const token of unexpected) problems.push(`${name} 覆盖图表高度：${token}`);
    }
  }
  return problems;
}

function hasImport(source: string, specifier: string, name: string): boolean {
  const pattern = new RegExp(`import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*['"]${specifier}['"]`, 'g');
  for (const match of source.matchAll(pattern)) {
    const locals = (match[1] ?? '').split(',').map((part) => {
      const trimmed = part.trim().replace(/^type\s+/, '');
      const alias = /\bas\s+([A-Za-z0-9_]+)\s*$/.exec(trimmed);
      if (alias?.[1]) return alias[1];
      return /([A-Za-z0-9_]+)\s*$/.exec(trimmed)?.[1] ?? '';
    });
    if (locals.includes(name)) return true;
  }
  return false;
}

function adminStringTitle(tag: string): string | null {
  const match = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\})/.exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function statShrinkProblems(source: string): string[] {
  const tags = findOpenTags(source, 'Stat');
  if (tags.length === 0) return ['没有 Stat'];
  const problems: string[] = [];
  let from = 0;
  for (const tag of tags) {
    const start = source.indexOf(tag.text, from);
    if (start < 0) {
      problems.push('找不到 Stat 标签');
      continue;
    }
    from = start + tag.text.length;
    const before = source.slice(Math.max(0, start - 800), start);
    const returnAt = before.lastIndexOf('return');
    const region = returnAt >= 0 ? before.slice(returnAt) : before;
    const host = classNameValues(region).at(-1) ?? '';
    const tokens = classTokens(host);
    if (!tokens.has('w-full') || !tokens.has('min-w-0')) {
      problems.push(host.length > 0 ? host : 'Stat 外层 className 缺少 w-full min-w-0');
    }
  }
  return problems;
}

describe('m01 admin dashboards, stats and dropbox', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 admin.tsx', () => {
    expectPageStructure(ADMIN, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('页面结构 admin-stats.tsx', () => {
    expectPageStructure(STATS, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('页面结构 admin-dropbox.tsx', () => {
    expectPageStructure(DROPBOX, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('把域管理、系统管理和系统状态从 h1 移到 AdminPage title', () => {
    const titles = findOpenTags(readSource(ADMIN), 'AdminPage').map((tag) => adminStringTitle(tag.text));
    expect(titles).toEqual([...ADMIN_TITLES]);
  });

  it('临时文件柜标题留在 AdminPage title', () => {
    const titles = findOpenTags(readSource(DROPBOX), 'AdminPage').map((tag) => adminStringTitle(tag.text));
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(titles.every((title) => title === '临时文件柜')).toBe(true);
  });

  it('admin-stats 用 Stat 和 Panel，图表仍用 EChart', () => {
    const src = readSource(STATS);
    expect(hasImport(src, '@/components/ui/display', 'Stat'), 'MetricCard 改为 Stat').toBe(true);
    expect(src).not.toMatch(/\bMetricCard\b/);
    expect(src).toMatch(/<Stat(?=[\s/>])/);
    expect(hasImport(src, '@/components/ui/panel', 'Panel'), 'ChartPanel 改为 Panel').toBe(true);
    expect(src).not.toMatch(/\bChartPanel\b/);
    expect(src).toMatch(/<Panel(?=[\s/>])/);
    expect(hasImport(src, '@/components/ui/echart', 'EChart')).toBe(true);
    expect(src).toMatch(/<EChart(?=[\s/>])/);
  });

  it('统计图容器有固定高度、全宽且允许收缩', () => {
    const page = readSource(STATS);
    expect(page).not.toContain('h-[280px]');
    expect(readSource(ECHART)).toContain(CHART_SHELL);
    expect(chartHeightProblems(page)).toEqual([]);
  });

  it('统计页不再用 600px 最小宽度把图表撑出视口', () => {
    expect(readSource(STATS)).not.toContain('min-w-[600px]');
  });

  it('统计仪表盘使用 12 列网格', () => {
    expectTokens(readSource(STATS), ['grid-cols-12']);
  });

  it('大屏也保持 12 列', () => {
    expectTokens(readSource(STATS), ['lg:grid-cols-12']);
  });

  it('主图表在大屏占 8 列', () => {
    // 父网格从最小断点起就是 grid-cols-12。同一条 className 只有 lg:col-span-8 时，平板默认占 1 列。
    expect(wideSpanProblems(readSource(STATS), 'lg:col-span-8')).toEqual([]);
  });

  it('侧栏图表在大屏占 4 列', () => {
    expect(wideSpanProblems(readSource(STATS), 'lg:col-span-4')).toEqual([]);
  });

  it('统计卡片不额外加阴影', () => {
    expectTokens(readSource(STATS), ['shadow-none']);
  });

  it('统计卡片全宽且可以在网格里收缩', () => {
    // 只看每个 Stat 所在 return 的外层 className。表单上的 w-full min-w-0 不能代替卡片。
    expect(statShrinkProblems(readSource(STATS))).toEqual([]);
  });

  it('统计页不得退回右侧固定 320px 的旧分栏', () => {
    expect(readSource(STATS)).not.toContain('xl:grid-cols-[minmax(0,1fr)_320px]');
  });
});
