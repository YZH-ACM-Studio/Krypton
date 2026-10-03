// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  countMatches,
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/collect/index.tsx';

const SLOT_ACTION_CLASSES = ['flex', 'min-w-0', 'flex-wrap'] as const;

function classLists(source: string): string[][] {
  const lists: string[][] = [];
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    lists.push((match[1] ?? '').split(/\s+/).filter((token) => token.length > 0));
  }
  return lists;
}

function hasClassList(source: string, tokens: readonly string[]): boolean {
  return classLists(source).some((list) => tokens.every((token) => list.includes(token)));
}

function classHas(value: string, tokens: readonly string[]): boolean {
  const list = value.split(/\s+/).filter((token) => token.length > 0);
  return tokens.every((token) => list.includes(token));
}

/** JSX text node, so「可替换」does not count as the slot action「替换」. */
function jsxTextIndex(source: string, text: string): number {
  const match = new RegExp(`>\\s*${text}\\s*<`).exec(source);
  if (match === null || match.index === undefined) {
    return -1;
  }
  return match.index + match[0].indexOf(text);
}

function classNamesImmediatelyBefore(source: string, needle: string, count: number): string[] {
  const index = needle === '替换' ? jsxTextIndex(source, needle) : source.indexOf(needle);
  if (index < 0) {
    return [];
  }
  const all = [...source.slice(0, index).matchAll(/className="([^"]*)"/g)].map((match) => match[1] ?? '');
  return all.slice(Math.max(0, all.length - count));
}

function nearbyHasClass(source: string, needle: string, tokens: readonly string[], radius = 500): boolean {
  let from = 0;
  while (from < source.length) {
    const index = source.indexOf(needle, from);
    if (index < 0) {
      return false;
    }
    const before = source.slice(Math.max(0, index - radius), index);
    for (const match of before.matchAll(/className="([^"]*)"/g)) {
      const list = (match[1] ?? '').split(/\s+/).filter((token) => token.length > 0);
      if (tokens.every((token) => list.includes(token))) {
        return true;
      }
    }
    from = index + needle.length;
  }
  return false;
}

function nearbyClassNames(source: string, needle: string, radius: number): string[] {
  const index = source.indexOf(needle);
  if (index < 0) {
    return [];
  }
  const before = source.slice(Math.max(0, index - radius), index);
  return [...before.matchAll(/className="([^"]*)"/g)].map((match) => match[1] ?? '');
}

function openingTag(source: string, needle: string): string {
  const index = source.indexOf(needle);
  if (index < 0) {
    return '';
  }
  const start = source.slice(0, index).lastIndexOf('<');
  if (start < 0) {
    return '';
  }
  const end = source.indexOf('>', start);
  if (end < 0 || end > index) {
    return '';
  }
  return source.slice(start, end + 1);
}

function badgeBlocks(source: string): Array<{ block: string; index: number }> {
  const found: Array<{ block: string; index: number }> = [];
  for (const match of source.matchAll(/<Badge\b[^>]*>[\s\S]*?<\/Badge>/g)) {
    if (match.index === undefined) {
      continue;
    }
    found.push({ block: match[0] ?? '', index: match.index });
  }
  return found;
}

function hasDepthZeroColon(text: string): boolean {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote: '"' | "'" | '`' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quote !== null) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren = Math.max(0, paren - 1);
    else if (char === '{') brace += 1;
    else if (char === '}') brace = Math.max(0, brace - 1);
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket = Math.max(0, bracket - 1);
    else if (char === ':' && paren === 0 && brace === 0 && bracket === 0) return true;
  }
  return false;
}

interface ConditionSide { negated: boolean; whenTrue: boolean }

function conditionSide(source: string, index: number, name: 'submitted' | 'closed'): ConditionSide | null {
  const before = source.slice(0, index);
  const expression = name === 'submitted'
    ? /(!)?\s*(?:(?:item|data)\.)?submitted\s*\?/g
    : /(!)?\s*closed\s*\?/g;
  let found: RegExpExecArray | null = null;
  for (const match of before.matchAll(expression)) {
    found = match;
  }
  if (found === null || found.index === undefined) {
    return null;
  }
  const afterQuestion = before.slice(found.index + found[0].length);
  const whenTrue = !hasDepthZeroColon(afterQuestion);
  const negated = found[1] === '!';
  return { negated, whenTrue };
}

/** True when this branch is shown if the named condition is true. */
function shownWhenCondition(side: ConditionSide): boolean {
  return side.negated ? !side.whenTrue : side.whenTrue;
}

function requireSide(source: string, index: number, name: 'submitted' | 'closed'): ConditionSide {
  const side = conditionSide(source, index, name);
  expect(side).not.toBeNull();
  if (side === null) {
    throw new TypeError(`missing ${name} condition`);
  }
  return side;
}

function hasTone(block: string, tone: string): boolean {
  return new RegExp(
    `\\btone\\s*=\\s*(?:["']${tone}["']|\\{\\s*["']${tone}["']\\s*\\}|\\{[^}]*["']${tone}["'][^}]*\\})`,
  ).test(block);
}

function buttonBlocks(source: string): string[] {
  const blocks: string[] = [];
  for (const match of source.matchAll(/<Button\b[^>]*>/g)) {
    const start = match.index;
    if (start === undefined) {
      continue;
    }
    const close = source.indexOf('</Button>', start);
    if (close < 0) {
      continue;
    }
    blocks.push(source.slice(start, close + '</Button>'.length));
  }
  return blocks;
}

describe('s15 file collection pages', () => {
  it('门禁零违规', () => {
    expectGateClean([PAGE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([PAGE]);
  });

  it('页面结构 index.tsx', () => {
    expectPageStructure(PAGE, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('学生收集页顶栏在窄屏下换行并可收缩', () => {
    expect(hasClassList(readSource(PAGE), [
      'flex',
      'min-w-0',
      'flex-wrap',
      'items-center',
      'justify-between',
      'gap-3',
    ])).toBe(true);
  });

  it('收集标题在窄屏下换行', () => {
    const src = readSource(PAGE);
    expect(nearbyHasClass(src, '文件收集', ['min-w-0', 'break-words'])).toBe(true);
    expect(nearbyHasClass(src, '{data.title}', ['min-w-0', 'break-words'])).toBe(true);
  });

  it('槽位标题行可折行并保持最小高度', () => {
    expect(nearbyHasClass(readSource(PAGE), '{item.title}', ['min-h-10', 'min-w-0'])).toBe(true);
  });

  it('槽位名称最多两行并占据可收缩空间', () => {
    expect(nearbyHasClass(readSource(PAGE), '{item.title}', ['min-w-0', 'flex-1', 'line-clamp-2'])).toBe(true);
  });

  it('槽位操作行在窄屏下换行', () => {
    // 只看「替换」前的近邻 className。页头那条 flex-wrap 离得远，不能代替槽位操作行。
    const nearby = classNamesImmediatelyBefore(readSource(PAGE), '替换', 8);
    expect(nearby.some((value) => classHas(value, SLOT_ACTION_CLASSES))).toBe(true);
  });

  it('槽位说明可以换行', () => {
    expect(nearbyHasClass(readSource(PAGE), '{slot.title}', ['min-w-0', 'break-words'])).toBe(true);
  });

  it('已交文件行在窄屏下分成可换行的两块', () => {
    expect(hasClassList(readSource(PAGE), ['flex', 'flex-wrap', 'items-start', 'gap-2'])).toBe(true);
  });

  it('已交文件名块占据剩余宽度并允许收缩', () => {
    expect(nearbyHasClass(readSource(PAGE), '{assignedName}', ['min-w-0', 'flex-1'])).toBe(true);
  });

  it('已交文件名按任意字符断行', () => {
    expect(openingTag(readSource(PAGE), '{assignedName}')).toMatch(/\bbreak-all\b/);
  });

  it('已交文件操作不收缩且可换行', () => {
    expect(hasClassList(readSource(PAGE), ['shrink-0', 'flex-wrap'])).toBe(true);
  });

  it('已交文件名不得用截断代替断行', () => {
    const classes = nearbyClassNames(readSource(PAGE), '{assignedName}', 800);
    expect(classes.length).toBeGreaterThan(0);
    for (const list of classes) {
      expect(list.split(/\s+/).includes('truncate')).toBe(false);
    }
  });

  it('分配文件名出现并按任意字符断行', () => {
    const src = readSource(PAGE);
    expect(src).toContain('{assignedName}');
    expect(openingTag(src, '{assignedName}')).toMatch(/\bbreak-all\b/);
  });

  it('分配文件名的辅助说明断行', () => {
    expect(nearbyHasClass(readSource(PAGE), '将保存为', ['break-all'], 200)).toBe(true);
  });

  it('学生收集页主操作保持两处 44px 高度', () => {
    expect(countMatches(readSource(PAGE), /className="[^"]*\bmin-h-11\b[^"]*"/g)).toBe(2);
  });

  it('确认提交按钮达到 44px 点击高度', () => {
    const confirms = buttonBlocks(readSource(PAGE)).filter((block) => block.includes('确认提交'));
    expect(confirms.length).toBeGreaterThan(0);
    for (const block of confirms) {
      const open = /<Button\b[^>]*>/.exec(block)?.[0] ?? '';
      expect(open).toMatch(/\bmin-h-11\b/);
    }
  });

  it('学生收集页页签横向滚动而不是裁切标签', () => {
    expect(hasClassList(readSource(PAGE), ['max-w-full', 'overflow-x-auto'])).toBe(true);
  });

  it('删除 SubmitStatusBadge 并改用规定的 Badge tone', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/function SubmitStatusBadge\b/);
    expect(src).not.toMatch(/<SubmitStatusBadge\b/);
    const blocks = badgeBlocks(src);
    // PLAN 的「已提交 / 未提交」对应现有文案「已交文件 / 未交文件」。收集不退回，不要求出现「被退回」。
    const submitted = blocks.filter((item) => item.block.includes('已交文件') || item.block.includes('已提交'));
    const pending = blocks.filter((item) => item.block.includes('未交文件') || item.block.includes('未提交'));
    const closed = blocks.filter((item) => item.block.includes('已截止'));
    expect(submitted.length).toBeGreaterThan(0);
    expect(pending.length).toBeGreaterThan(0);
    expect(closed.length).toBeGreaterThan(0);
    for (const item of submitted) {
      const side = requireSide(src, item.index, 'submitted');
      expect(shownWhenCondition(side), '已交文件必须在 submitted 为真时出现').toBe(true);
      expect(hasTone(item.block, 'success'), '已提交 → success').toBe(true);
    }
    for (const item of pending) {
      const side = requireSide(src, item.index, 'submitted');
      expect(shownWhenCondition(side), '未交文件必须在 submitted 为假时出现').toBe(false);
      expect(hasTone(item.block, 'neutral'), '未提交 → neutral').toBe(true);
    }
    for (const item of closed) {
      const side = requireSide(src, item.index, 'closed');
      expect(shownWhenCondition(side), '已截止必须在 closed 为真时出现').toBe(true);
      expect(hasTone(item.block, 'warning'), '已截止 → warning').toBe(true);
    }
    for (const item of blocks.filter((entry) => entry.block.includes('被退回'))) {
      expect(hasTone(item.block, 'danger'), '被退回 → danger').toBe(true);
    }
  });

  it('上传区继续使用现有 FileUploader', () => {
    const src = readSource(PAGE);
    expect(src).toContain("from '@/components/uploader'");
    expect(src).toMatch(/<FileUploader\b/);
  });
});
