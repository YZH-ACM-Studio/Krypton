// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const PAGE = 'src/pages/admin-tasks/index.tsx';
const YEAR_INPUT = 'src/components/task-year-set-input.tsx';
const LANE_FILES = [PAGE, YEAR_INPUT] as const;

const CARD_NAMES = ['Card', 'CardHeader', 'CardTitle', 'CardContent', 'CardDescription'] as const;
const EMPTY_PHRASE = '还没有任务';
const YEAR_SENTENCE = '现有年份配置格式无效；系统没有改写它。请删除并重新添加这个任务节点。';
const STATS_GRID = ['grid', 'grid-cols-2', 'xl:grid-cols-4', 'gap-4'] as const;
const LIST_DIVIDE = ['divide-y', 'divide-line-subtle'] as const;

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function isTagBoundary(char: string | undefined): boolean {
  return char === '>' || char === '/' || char === undefined || /\s/.test(char);
}

function importedLocals(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?(?:[\w*]+\s*,\s*)?\{([^}]*)\}/g)) {
    const body = match[1] ?? '';
    for (const part of body.split(',')) {
      const trimmed = part.trim();
      if (trimmed.length === 0) continue;
      const alias = /\bas\s+(\w+)$/.exec(trimmed);
      const local = alias?.[1] ?? trimmed.replace(/^type\s+/, '').split(/\s+/)[0] ?? '';
      if (local.length > 0) names.push(local);
    }
  }
  return names;
}

function classTokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 0));
}

function hasTokens(value: string, required: readonly string[]): boolean {
  const present = classTokens(value);
  return required.every((token) => present.has(token));
}

function hasRoundedBorderBox(value: string): boolean {
  const present = classTokens(value);
  if (!present.has('rounded-md')) return false;
  for (const token of present) {
    const utility = token.split(':').pop() ?? '';
    if (utility === 'border' || utility.startsWith('border-')) return true;
  }
  return false;
}

/** 一个 className 属性里的字面量拼成一组，cn() 拆开的字符串也算同一组。 */
function classNameGroups(source: string): string[] {
  const groups: string[] = [];
  for (const match of source.matchAll(/className=(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{([\s\S]*?)\})/g)) {
    const quoted = match[1] ?? match[2] ?? match[3];
    if (quoted !== undefined) {
      groups.push(quoted);
      continue;
    }
    const expression = match[4] ?? '';
    const literals = [...expression.matchAll(/['"`]([^'"`]*)['"`]/g)].map((item) => item[1] ?? '');
    groups.push(literals.join(' '));
  }
  return groups;
}

function classNameAt(source: string, at: number): string | null {
  const groups = classNameGroups(source.slice(at));
  return groups[0] ?? null;
}

function classNamesBefore(source: string, index: number, span: number): string[] {
  return classNameGroups(source.slice(Math.max(0, index - span), index));
}

interface ElementBlock {
  open: string;
  all: string;
}

function elementBlocks(source: string, tag: string): ElementBlock[] {
  const close = `</${tag}>`;
  const blocks: ElementBlock[] = [];
  let from = 0;
  for (const open of findOpenTags(source, tag)) {
    const at = source.indexOf(open.text, from);
    if (at < 0) continue;
    const after = at + open.text.length;
    if (/\/\s*>$/.test(open.text)) {
      blocks.push({ open: open.text, all: open.text });
      from = after;
      continue;
    }
    const end = source.indexOf(close, after);
    const all = end < 0 ? open.text : source.slice(at, end + close.length);
    blocks.push({ open: open.text, all });
    from = end < 0 ? after : end + close.length;
  }
  return blocks;
}

function lastIndexOfTag(source: string, tag: string, before: number): number {
  const needle = `<${tag}`;
  let from = 0;
  let found = -1;
  while (from < before) {
    const at = source.indexOf(needle, from);
    if (at < 0 || at >= before) break;
    if (isTagBoundary(source[at + needle.length])) found = at;
    from = at + needle.length;
  }
  return found;
}

function insideTable(source: string, index: number): boolean {
  const open = lastIndexOfTag(source, 'Table', index);
  if (open < 0) return false;
  const close = source.slice(0, index).lastIndexOf('</Table>');
  return close < open;
}

function normalized(value: string): string {
  return value.replaceAll(/\s+/g, '');
}

describe('q16 task administration panels, empty states, group tones, year alert', () => {
  it('不再 import 或使用 Card、CardHeader、CardTitle、CardContent、CardDescription', () => {
    const source = readSource(PAGE);
    const imported = new Set(importedLocals(source));
    const problems: string[] = [];
    for (const name of CARD_NAMES) {
      if (imported.has(name)) problems.push(`import 了 ${name}`);
      for (const tag of findOpenTags(source, name)) {
        problems.push(`${tag.line}: <${name}`);
      }
      if (source.includes(`</${name}>`)) problems.push(`使用了 </${name}>`);
    }
    expect(problems).toEqual([]);
  });

  it('空状态至少 5 个 EmptyState，源码不含 py-12，「还没有任务」只在开标签属性里', () => {
    const source = readSource(PAGE);
    const tags = findOpenTags(source, 'EmptyState');
    expect(tags.length).toBeGreaterThanOrEqual(5);
    expect(source.includes('py-12')).toBe(false);

    const holders = tags.filter((tag) => tag.text.includes(EMPTY_PHRASE));
    expect(holders.length).toBeGreaterThan(0);
    for (const tag of holders) {
      expect(tag.text).toContain('点击右上角');
      expect(tag.text).toContain('新建任务');
    }

    let rest = source;
    for (const tag of holders) {
      const at = rest.indexOf(tag.text);
      if (at < 0) continue;
      rest = `${rest.slice(0, at)}${rest.slice(at + tag.text.length)}`;
    }
    expect(rest.includes(EMPTY_PHRASE)).toBe(false);

    const inside: string[] = [];
    for (const tag of tags) {
      const at = source.indexOf(tag.text);
      if (at >= 0 && insideTable(source, at)) inside.push(`${tag.line}: EmptyState 在 Table 内`);
    }
    expect(inside).toEqual([]);
  });

  it('工具箱分组不再使用 info/warning 色，悬停边框是 hover:border-line-strong，图标是 text-fg-subtle', () => {
    const source = readSource(PAGE);
    const forbidden = ['text-info-fg', 'hover:border-info-line', 'hover:border-warning-line'] as const;
    const hits = forbidden.filter((token) => source.includes(token));
    expect(hits).toEqual([]);

    const toolbox = functionBody(source, 'Toolbox');
    expect(toolbox.length).toBeGreaterThan(0);
    expect(toolbox.includes('text-warning-fg')).toBe(false);
    expect(toolbox.includes('hover:border-line-strong')).toBe(true);

    const icons = findOpenTags(toolbox, 'g.icon');
    expect(icons.length).toBeGreaterThan(0);
    const iconProblems = icons
      .filter((icon) => !icon.text.includes('text-fg-subtle') || icon.text.includes('text-warning-fg') || icon.text.includes('text-info-fg'))
      .map((icon) => `${icon.line}: ${icon.text.replaceAll(/\s+/g, ' ')}`);
    expect(iconProblems).toEqual([]);
  });

  it('审计日志与进度抽屉任务点是 divide-y 列表，条目 py-3 且没有 rounded-md border', () => {
    const source = readSource(PAGE);
    const problems: string[] = [];

    const auditAt = source.indexOf('data.audit.map');
    if (auditAt < 0) {
      problems.push('找不到 data.audit.map');
    } else {
      const parents = classNamesBefore(source, auditAt, 800);
      if (!parents.some((value) => hasTokens(value, LIST_DIVIDE))) {
        problems.push(`审计列表父容器 class 缺少 divide-y divide-line-subtle：${parents.join(' | ')}`);
      }
      const item = classNameAt(source, auditAt) ?? '';
      if (!classTokens(item).has('py-3')) problems.push(`审计条目 class 缺少 py-3：${item}`);
      if (hasRoundedBorderBox(item)) problems.push(`审计条目仍是 rounded-md border：${item}`);
    }

    const row = functionBody(source, 'AdminNodeProgressRow');
    if (row.length === 0) {
      problems.push('找不到 AdminNodeProgressRow');
    } else {
      const groups = classNameGroups(row);
      if (!groups.some((value) => classTokens(value).has('py-3'))) problems.push('进度任务点没有 py-3');
      const boxed = groups.filter((value) => hasRoundedBorderBox(value));
      for (const value of boxed) problems.push(`进度任务点仍是 rounded-md border：${value}`);
    }

    const needle = '<AdminNodeProgressRow';
    let from = 0;
    let calls = 0;
    while (from < source.length) {
      const at = source.indexOf(needle, from);
      if (at < 0) break;
      calls += 1;
      const parents = classNamesBefore(source, at, 800);
      if (!parents.some((value) => hasTokens(value, LIST_DIVIDE))) {
        problems.push(`进度列表父容器 class 缺少 divide-y divide-line-subtle：${parents.join(' | ')}`);
      }
      from = at + needle.length;
    }
    if (calls === 0) problems.push('找不到 AdminNodeProgressRow 调用');

    expect(problems).toEqual([]);
  });

  it('统计页一个 Panel 里用 grid-cols-2 xl:grid-cols-4 放下四张 Stat', () => {
    const body = functionBody(readSource(PAGE), 'AdminTasksStatsPage');
    expect(body.length).toBeGreaterThan(0);
    const hits = elementBlocks(body, 'Panel').filter((block) => {
      const grid = classNameGroups(block.all).some((value) => hasTokens(value, STATS_GRID));
      return grid && findOpenTags(block.all, 'Stat').length === 4;
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('非法年份提示是 Alert tone="danger"，文案不变，且不含 border-danger', () => {
    const source = readSource(YEAR_INPUT);
    expect(source.includes('border-danger')).toBe(false);
    const matched = elementBlocks(source, 'Alert').filter((block) => (
      block.open.includes('tone="danger"') && normalized(block.all).includes(normalized(YEAR_SENTENCE))
    ));
    expect(matched.length).toBeGreaterThan(0);
  });

  it('门禁对本 lane 文件退出码为 0', () => {
    expectGateClean([...LANE_FILES]);
  });
});
