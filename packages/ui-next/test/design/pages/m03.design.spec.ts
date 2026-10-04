// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  countMatches,
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/admin-tasks/index.tsx';
const YEAR_INPUT = 'src/components/task-year-set-input.tsx';
const LANE_FILES = [PAGE, YEAR_INPUT] as const;

const STATS_HEADER = ['flex', 'max-w-full', 'flex-wrap', 'gap-2'] as const;
const CANDIDATES_HEADER = ['flex', 'max-w-full', 'flex-wrap', 'items-center', 'gap-2'] as const;

const TASK_STATE_TONES = [
  ['启用', 'success'],
  ['草稿', 'neutral'],
  ['停用', 'warning'],
] as const;

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

function hasTokenString(source: string, tokens: readonly string[]): boolean {
  return quotedStrings(source).some((text) => {
    const parts = text.split(/\s+/);
    return tokens.every((token) => parts.includes(token));
  });
}

function badgeBlocks(source: string): string[] {
  return [...source.matchAll(/<Badge\b[^>]*>[\s\S]*?<\/Badge>/g)].map((match) => match[0] ?? '');
}

function showsLabel(block: string, label: string): boolean {
  return new RegExp(`>\\s*${label}\\s*<`).test(block) || new RegExp(`['"\`]${label}['"\`]`).test(block);
}

function hasTone(block: string, tone: string): boolean {
  return new RegExp(`\\btone\\s*=\\s*(?:["']${tone}["']|\\{[^}]*["']${tone}["'][^}]*\\})`).test(block);
}

describe('m03 task administration', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 admin-tasks/index.tsx', () => {
    expectPageStructure(PAGE, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('七个导出页面保持 ModuleWorkspace，不改成直接写 AdminPage', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/<AdminPage\b/);
    expect(countMatches(src, /<ModuleWorkspace\b/g)).toBe(7);
  });

  it('任务统计页头部操作在窄工作区换行', () => {
    const body = functionBody(readSource(PAGE), 'AdminTasksStatsPage');
    expect(body.length).toBeGreaterThan(0);
    expect(hasTokenString(body, STATS_HEADER)).toBe(true);
  });

  it('候选名单页头部操作换行并垂直居中', () => {
    const body = functionBody(readSource(PAGE), 'AdminTasksCandidatesPage');
    expect(body.length).toBeGreaterThan(0);
    expect(hasTokenString(body, CANDIDATES_HEADER)).toBe(true);
  });

  it('删除局部 StatusBadge，启用、草稿和停用使用规定的 Badge tone', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/function StatusBadge\b/);
    expect(src).not.toMatch(/<StatusBadge\b/);
    const blocks = badgeBlocks(src);
    // 任务只有 isActive 两态，源码没有「草稿」。不新增该词；一旦出现必须是 neutral。
    for (const [label, tone] of TASK_STATE_TONES) {
      const matched = blocks.filter((block) => showsLabel(block, label));
      if (label !== '草稿') {
        expect(matched.length, label).toBeGreaterThan(0);
      }
      for (const block of matched) {
        expect(hasTone(block, tone), `${label} → ${tone}`).toBe(true);
      }
    }
  });

  it('任务图非全屏高度改为 h-[min(68vh,40rem)]，源码不含 100dvh', () => {
    const page = readSource(PAGE);
    const yearInput = readSource(YEAR_INPUT);
    expect(page).not.toMatch(/100dvh/);
    expect(yearInput).not.toMatch(/100dvh/);
    // 两个类必须留在 fullscreen 三元的对应分支上，不能只在文件里共存。
    expect(page).toMatch(/fullscreen\s*\?\s*(['"])h-full flex-1\1\s*:\s*(['"])h-\[min\(68vh,40rem\)\]\2/);
    expect(page).not.toMatch(/fullscreen\s*\?\s*(['"])h-\[min\(68vh,40rem\)\]\1\s*:\s*(['"])h-full flex-1\2/);
  });
});
