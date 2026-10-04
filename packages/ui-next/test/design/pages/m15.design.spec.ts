// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const CREATE_HUB = 'src/pages/problem-create-hub.tsx';
const MINE = 'src/pages/problem-mine.tsx';
const NAMESPACES = 'src/pages/problem-pid-namespaces.tsx';
const REVIEW = 'src/pages/problem-review.tsx';
const PERMITS = 'src/pages/permits/inbox.tsx';

const ROUTER = 'src/router.tsx';
const PAGE_UI = 'src/components/ui/page.tsx';

const LANE_FILES = [CREATE_HUB, MINE, NAMESPACES, REVIEW, PERMITS] as const;

/**
 * PLAN 的四个简称。审核队列不改文案：两态都还在「全部待处理」里，
 * 「首次审核」和「等待重新公开」都按待审使用 warning，不能只锁真分支。
 */
const REVIEW_STATUS_TONES = [
  ['待审', 'warning'],
  ['通过', 'success'],
  ['驳回', 'danger'],
  ['草稿', 'neutral'],
  ['首次审核', 'warning'],
  ['等待重新公开', 'warning'],
] as const;

const REVIEW_QUEUE_BRANCHES = [
  ['首次审核', 'warning'],
  ['等待重新公开', 'warning'],
] as const;

const OLD_DIRECT_VAR = /var\(\s*--(?:background|foreground|card|popover|muted|accent|primary|secondary|destructive|border|input)(?:-foreground)?\b/g;

function componentSlice(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) return '';
  const rest = source.slice(start);
  const next = rest.slice(signature.length).search(/\nexport function /);
  return next < 0 ? rest : rest.slice(0, signature.length + next);
}

function returnedRoot(source: string): { name: string; attrs: string } | null {
  const match = /return\s*(?:\(\s*)?<([A-Za-z][\w.]*)\b([^>]*)>/.exec(source);
  if (match === null) return null;
  return { name: match[1] ?? '', attrs: match[2] ?? '' };
}

function elementClose(source: string, open: number): number {
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

/** 壳层 padding 只在 Outlet 的直接父节点用直接子选择器命中 page slot 时取消。选择器本身含 `>`，必须按引号跳过。 */
function shellDropsPaddingForPageSlot(source: string): boolean {
  const marker = 'has-[>[data-slot=page]]:p-0';
  let from = 0;
  while (from < source.length) {
    const open = source.indexOf('<div', from);
    if (open < 0) return false;
    const next = source[open + 4] ?? '';
    if (next !== ' ' && next !== '\n' && next !== '\t' && next !== '>') {
      from = open + 4;
      continue;
    }
    const close = elementClose(source, open);
    if (close < 0) return false;
    const directOutlet = /^\s*<Outlet\b/.test(source.slice(close + 1));
    if (source.slice(open, close).includes(marker) && directOutlet) return true;
    from = open + 4;
  }
  return false;
}

function pageRootIsSlot(source: string): { attrs: string } | null {
  const slice = componentSlice(source, 'export function Page(');
  const root = returnedRoot(slice);
  if (root === null || root.name !== 'div') return null;
  if (!root.attrs.includes('data-slot="page"')) return null;
  return root;
}

function badgeBlocks(source: string): string[] {
  return [...source.matchAll(/<Badge\b[^>]*>[\s\S]*?<\/Badge>/g)].map((match) => match[0] ?? '');
}

function badgeLabelTexts(block: string): string[] {
  const body = block.replace(/^<Badge\b[^>]*>/, '').replace(/<\/Badge>$/, '');
  const texts: string[] = [];
  for (const match of body.matchAll(/>([^<{]+)</g)) {
    const text = (match[1] ?? '').trim();
    if (text.length > 0) texts.push(text);
  }
  for (const match of body.matchAll(/['"]([^'"]+)['"]/g)) {
    const text = (match[1] ?? '').trim();
    if (text.length > 0) texts.push(text);
  }
  return texts;
}

function normalizeCond(condition: string): string {
  return condition.replace(/\s+/g, '');
}

/** 同一条件的两个分支必须成对：显示该文案的分支用规定 tone，不能只是字符串同时出现。 */
function toneForLabel(block: string, label: string): string | null {
  const literal = /\btone\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*["']([^"']+)["']\s*\})/.exec(block);
  if (literal && badgeLabelTexts(block).includes(label)) {
    return literal[1] ?? literal[2] ?? literal[3] ?? null;
  }
  const toneTernary = /\btone\s*=\s*\{([^{}]+)\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']\s*\}/.exec(block);
  if (toneTernary === null) return null;
  const toneCond = normalizeCond(toneTernary[1] ?? '');
  const toneAt = toneTernary.index ?? 0;
  const textTernary = /\{([^{}]+)\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']\s*\}/g;
  for (const match of block.matchAll(textTernary)) {
    if ((match.index ?? 0) === toneAt) continue;
    if (normalizeCond(match[1] ?? '') !== toneCond) continue;
    if (match[2] === label) return toneTernary[2] ?? null;
    if (match[3] === label) return toneTernary[3] ?? null;
  }
  return null;
}

describe('m15 problem bank management', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 problem-create-hub.tsx', () => {
    expectPageStructure(CREATE_HUB, {
      widths: ['wide', 'form'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 problem-mine.tsx', () => {
    expectPageStructure(MINE, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 problem-pid-namespaces.tsx', () => {
    expectPageStructure(NAMESPACES, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 problem-review.tsx', () => {
    expectPageStructure(REVIEW, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 permits/inbox.tsx', () => {
    expectPageStructure(PERMITS, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('problem-create-hub 的根是 Page，壳层直接子节点才会取消 padding', () => {
    const router = readSource(ROUTER);
    const pageRoot = pageRootIsSlot(readSource(PAGE_UI));
    const root = returnedRoot(componentSlice(readSource(CREATE_HUB), 'function ProblemCreateHubView'));
    expect(shellDropsPaddingForPageSlot(router)).toBe(true);
    expect(pageRoot).not.toBeNull();
    expect(root?.name).toBe('Page');
  });

  it('problem-create-hub 靠 Page 根的 w-full 占满壳内容宽度', () => {
    const pageRoot = pageRootIsSlot(readSource(PAGE_UI));
    const root = returnedRoot(componentSlice(readSource(CREATE_HUB), 'function ProblemCreateHubView'));
    expect(pageRoot?.attrs ?? '').toMatch(/\bw-full\b/);
    expect(root?.name).toBe('Page');
  });

  it('problem-create-hub 的根不另写 mx-auto', () => {
    const root = returnedRoot(componentSlice(readSource(CREATE_HUB), 'function ProblemCreateHubView'));
    expect(shellDropsPaddingForPageSlot(readSource(ROUTER))).toBe(true);
    expect(root?.name).toBe('Page');
    expect(root?.attrs ?? '').not.toMatch(/\bmx-auto\b/);
  });

  it('problem-create-hub 的根不另写 max-w-', () => {
    const root = returnedRoot(componentSlice(readSource(CREATE_HUB), 'function ProblemCreateHubView'));
    expect(root?.name).toBe('Page');
    expect(root?.attrs ?? '').toMatch(/\bwidth="(?:wide|form)"/);
    expect(root?.attrs ?? '').not.toMatch(/\bmax-w-/);
  });

  it('审核状态待审、通过、驳回、草稿和队列两态使用规定的 Badge tone', () => {
    const blocks = LANE_FILES.flatMap((file) => badgeBlocks(readSource(file)));
    const problems: string[] = [];
    for (const [label, tone] of REVIEW_STATUS_TONES) {
      for (const block of blocks) {
        const actual = toneForLabel(block, label);
        if (actual === null) continue;
        if (actual !== tone) problems.push(`${label} → ${tone}，实际 ${actual}`);
      }
    }
    const queue = blocks.filter((block) => REVIEW_QUEUE_BRANCHES.every(([label]) => toneForLabel(block, label) !== null));
    if (queue.length === 0) {
      problems.push('审核徽标没有把「首次审核」和「等待重新公开」按同一条件分到两个 tone 分支');
    }
    for (const block of queue) {
      for (const [label, tone] of REVIEW_QUEUE_BRANCHES) {
        const actual = toneForLabel(block, label);
        if (actual !== tone) problems.push(`${label} → ${tone}，实际 ${actual ?? '缺失'}`);
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it('problem-pid-namespaces.tsx 不再直接写旧 CSS 变量', () => {
    const src = readSource(NAMESPACES);
    const found = [...src.matchAll(new RegExp(OLD_DIRECT_VAR.source, 'g'))].map((match) => match[0]);
    expect(found).toEqual([]);
  });
});
