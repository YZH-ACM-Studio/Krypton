// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/user-account.tsx',
  'src/pages/user-account-settings.ts',
  'src/pages/messages/panel.tsx',
  'src/pages/messages/thread.tsx',
  'src/pages/messages/conversation-list.tsx',
  'src/pages/messages/composer.tsx',
  'src/pages/messages/new-conversation.tsx',
  'src/pages/messages/content.tsx',
] as const;

const ACCOUNT = 'src/pages/user-account.tsx';
const PANEL = 'src/pages/messages/panel.tsx';
const CONVERSATION_LIST = 'src/pages/messages/conversation-list.tsx';

const BRAND_TONE = /tone="brand"|tone='brand'|tone=\{["']brand["']\}/;

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

function previewClassText(source: string): string {
  const at = source.search(/highlightText\(\s*preview\b/);
  if (at < 0) {
    return '';
  }
  const before = source.slice(Math.max(0, at - 400), at);
  return [...before.matchAll(/['"`]([^'"`]*)['"`]/g)].map((item) => item[1] ?? '').join(' ');
}

describe('s14 user account and messages', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 user-account.tsx', () => {
    expectPageStructure(ACCOUNT, {
      widths: ['wide', 'form'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('账户设置顶栏在窄宽度下横向滚动，页签不被裁掉', () => {
    expect(readSource(ACCOUNT)).toMatch(/\boverflow-x-auto\b/);
  });

  it('账户设置主列限制在中等阅读宽度，而不是铺满整屏', () => {
    expect(readSource(ACCOUNT)).toMatch(/\bmax-w-3xl\b/);
  });

  it('大屏设置表单按三列排布', () => {
    expect(readSource(ACCOUNT)).toMatch(/\blg:grid-cols-3\b/);
  });

  it('设置页的操作行和页脚允许换行，避免窄屏挤出视口', () => {
    expect(readSource(ACCOUNT)).toMatch(/\bflex-wrap\b/);
  });

  it('设置页不再使用 200px 标签列加剩余内容列的旧网格', () => {
    expect(readSource(ACCOUNT)).not.toContain('sm:grid-cols-[200px_1fr]');
  });

  it('长最后一条消息的预览带 truncate，且不靠该类名查找节点', () => {
    expect(previewClassText(readSource(CONVERSATION_LIST))).toMatch(/\btruncate\b/);
  });

  it('会话列表里能找到带截断样式的最后一条预览', () => {
    expect(previewClassText(readSource(CONVERSATION_LIST))).toMatch(/\btruncate\b/);
  });

  it('截断预览可以在行内收缩，长文本不把会话行撑破', () => {
    expect(previewClassText(readSource(CONVERSATION_LIST))).toMatch(/\bmin-w-0\b/);
  });

  it('截断预览占据行内剩余宽度', () => {
    expect(previewClassText(readSource(CONVERSATION_LIST))).toMatch(/\bflex-1\b/);
  });

  it('消息面板不再用 480px 最小高度', () => {
    expect(readSource(PANEL)).not.toContain('min-h-[480px]');
  });

  it('消息面板在父级 flex 中占据剩余空间', () => {
    expect(readSource(PANEL)).toMatch(/\bflex-1\b/);
  });

  it('消息面板可以在 flex 列里收缩，从而形成内部滚动', () => {
    expect(readSource(PANEL)).toMatch(/\bmin-h-0\b/);
  });

  it('会话项选中态使用 bg-surface-active', () => {
    expect(readSource(CONVERSATION_LIST)).toMatch(/\bselected\b[\s\S]{1,120}\bbg-surface-active\b/);
  });

  it('未读点使用 StatusDot tone="brand"', () => {
    const tags = [...readSource(CONVERSATION_LIST).matchAll(/<StatusDot\b[^>]*>/g)].map((match) => match[0] ?? '');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((tag) => BRAND_TONE.test(tag))).toBe(true);
  });

  it('把 StudentIdentityCard 换成 Panel 与 DescriptionList', () => {
    const body = functionBody(readSource(ACCOUNT), 'StudentIdentityCard');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/<Panel(?=[\s>/])/);
    expect(body).toMatch(/<DescriptionList(?=[\s>/])/);
    expect(body).not.toMatch(/<Card(?=[\s>/])/);
    expect(body).not.toMatch(/<Card(?:Header|Content|Footer|Title|Description)\b/);
  });
});
