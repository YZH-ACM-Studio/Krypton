// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean, expectPageStructure, readSource } from '../helpers.ts';

const PAGE = 'src/pages/training.tsx';

const STATUS_TONES = [
  ['已完成', 'success'],
  ['进行中', 'info'],
  ['未开始', 'neutral'],
] as const;

const CARD_CLASS = 'rounded-lg border border-line bg-surface p-4 shadow-xs';
const DETAIL_GRID = 'lg:grid-cols-[minmax(0,1fr)_22rem]';
const LEGACY_DETAIL_GRID = 'lg:grid-cols-[64fr_36fr]';

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

function detailRootTag(source: string): string {
  const match = /return\s*\(\s*<[A-Za-z][\w.]*\b[^>]*>/.exec(functionBody(source, 'TrainingDetailPage'));
  return match?.[0] ?? '';
}

function badgeBlocks(source: string): string[] {
  return [...source.matchAll(/<Badge\b[^>]*>[\s\S]*?<\/Badge>/g)].map((match) => match[0] ?? '');
}

// 「已完成当前题集」和「已完成 ${n} 个阶段」是另一组文案，不套这三档 tone。
function exactStatusLabel(block: string, label: string): boolean {
  return new RegExp(`${label}(?![\\u4e00-\\u9fff]|\\s*\\$|\\s*\\d)`).test(block);
}

function hasTone(block: string, tone: string): boolean {
  return new RegExp(`\\btone\\s*=\\s*(?:["']${tone}["']|\\{\\s*["']${tone}["']\\s*\\}|\\{[^}]*["']${tone}["'][^}]*\\})`).test(block);
}

describe('s09 problem sets', () => {
  it('门禁零违规', () => {
    expectGateClean([PAGE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([PAGE]);
  });

  it('页面结构 training.tsx', () => {
    expectPageStructure(PAGE, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('训练详情根节点带 w-full', () => {
    expect(detailRootTag(readSource(PAGE))).toMatch(/\bw-full\b/);
  });

  it('训练详情根节点带 min-w-0', () => {
    expect(detailRootTag(readSource(PAGE))).toMatch(/\bmin-w-0\b/);
  });

  it('题集详情主体使用 lg:grid-cols-[minmax(0,1fr)_22rem]', () => {
    const src = readSource(PAGE);
    expect(src).toContain(DETAIL_GRID);
    expect(src).not.toContain(LEGACY_DETAIL_GRID);
  });

  it('删除 StatBlock 并改用 Stat', () => {
    const src = readSource(PAGE);
    expect(src).toMatch(/<Stat(?=[\s/>])/);
    expect(src).not.toMatch(/function StatBlock\b/);
    expect(src).not.toMatch(/<StatBlock\b/);
  });

  it('删除 SectionStatusBadge 并用规定的 Badge tone', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/function SectionStatusBadge\b/);
    expect(src).not.toMatch(/<SectionStatusBadge\b/);
    for (const [label, tone] of STATUS_TONES) {
      const blocks = badgeBlocks(src).filter((block) => exactStatusLabel(block, label));
      expect(blocks.length, label).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(hasTone(block, tone), `${label} → ${tone}`).toBe(true);
      }
    }
  });

  it('删除 TrainingCard 并改用规范卡片', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/function TrainingCard\b/);
    expect(src).not.toMatch(/<TrainingCard\b/);
    expect(src).toContain(CARD_CLASS);
    expect(src).toContain('hover:border-line-strong');
    expect(src).toContain('hover:shadow-sm');
  });

  it('进度条用 Progress', () => {
    const src = readSource(PAGE);
    expect(src).toMatch(/<Progress(?=[\s/>])/);
    expect(src).not.toMatch(/style=\{\{\s*width:\s*`\$\{(?:pct|progress)\}%`\s*\}\}/);
  });
});
