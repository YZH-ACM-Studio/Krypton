// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean, readSource } from '../helpers.ts';

const LANE_FILES = [
  'src/components/announcement-popover.tsx',
  'src/components/stats-group-filter.tsx',
] as const;

const POPOVER = 'src/components/announcement-popover.tsx';

// 两个文件都是组件，结构规格只有门禁，没有页面结构。
// fixed right-3 与 max-h-[min(28rem,calc(...))] 仍不单测：前者是锚定位置，后者由 Popover 的 maxHeight 承担。
// 宽度取 min(360px, 视口剩余) 是防溢出，不能只写 w-80。

function quotedStrings(source: string): string[] {
  return [...source.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => match[1] ?? '');
}

function hasClassTokens(source: string, tokens: readonly string[]): boolean {
  return quotedStrings(source).some((value) => {
    const present = new Set(value.split(/\s+/).filter((token) => token.length > 0));
    return tokens.every((token) => present.has(token));
  });
}

function forwardsPopoverAria(source: string): boolean {
  if (source.includes('aria-expanded')) return true;
  return /<Button\b[^>]*\{\.\.\.[A-Za-z_$][\w$]*\}/.test(source);
}

describe('s21 topbar announcement popover and stats group filter', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('公告浮层不得再是脱离视口的固定 360px 宽', () => {
    expect(readSource(POPOVER)).not.toContain('w-[360px]');
  });

  it('公告浮层不得相对触发器绝对定位', () => {
    expect(readSource(POPOVER)).not.toContain('absolute right-0 top-full');
  });

  it('公告弹层改用 Popover', () => {
    const src = readSource(POPOVER);
    expect(src).toContain("from '@/components/ui/menu'");
    expect(src).toMatch(/<Popover\b/);
  });

  it('公告弹层宽度为 w-80', () => {
    expect(hasClassTokens(readSource(POPOVER), ['w-80'])).toBe(true);
  });

  it('公告浮层宽度取 360px 与视口剩余宽度的较小值', () => {
    expect(hasClassTokens(readSource(POPOVER), ['w-[min(360px,calc(100vw-1.5rem))]'])).toBe(true);
  });

  it('公告列表项使用 divide-y divide-line-subtle', () => {
    expect(hasClassTokens(readSource(POPOVER), ['divide-y', 'divide-line-subtle'])).toBe(true);
  });

  it('未读点使用 StatusDot tone=brand', () => {
    const tags = [...readSource(POPOVER).matchAll(/<StatusDot\b[^>]*>/g)].map((match) => match[0]);
    expect(tags.some((tag) => tag.includes('tone="brand"'))).toBe(true);
  });

  it('触发器保持公告入口并接上 Popover 的 aria', () => {
    const src = readSource(POPOVER);
    expect(src).toMatch(/export function AnnouncementPopover\b/);
    expect(src).toContain('signedIn');
    expect(src).toContain('title="公告"');
    expect(forwardsPopoverAria(src)).toBe(true);
  });
});
