// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const REDEMPTION = 'src/pages/redemption-manage.tsx';
const REALPASS = 'src/pages/realpass-manage.tsx';
const PLUGINS = 'src/pages/plugin-pages.tsx';
const LANE_FILES = [REDEMPTION, REALPASS, PLUGINS] as const;

// legacy-intents T01–T04 里，本 lane 只有 realpass-manage.tsx 的这一条。
// 改写后仍要断言 viewportLayout="block"，并且 ScrollArea 带 max-h-80。

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

function quotedAttr(tag: string, name: string, value: string): boolean {
  return tag.includes(`${name}="${value}"`);
}

function returnedOpenTag(body: string): string {
  const match = /return\s*\(\s*(<[\s\S]*?>)/.exec(body);
  return match?.[1] ?? '';
}

function isTag(tag: string, name: string): boolean {
  return new RegExp(`^<${name}(?=[\\s>/])`).test(tag);
}

function headerCarries(source: string, title: string): boolean {
  return findOpenTags(source, 'PageHeader').some((tag) => tag.text.includes(title));
}

function isPrimaryButton(tag: string): boolean {
  return /variant\s*=\s*(?:"primary"|'primary'|\{\s*['"]primary['"]\s*\})/.test(tag);
}

function primaryButtonLabels(body: string): string[] {
  return findOpenTags(body, 'Button').flatMap((tag) => {
    if (!isPrimaryButton(tag.text)) return [];
    const at = body.indexOf(tag.text);
    const end = at < 0 ? -1 : body.indexOf('</Button>', at + tag.text.length);
    const raw = end < 0 ? '' : body.slice(at + tag.text.length, end);
    const label = raw.replace(/<[^>]+>/g, '').replace(/\{[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
    return [label];
  });
}

describe('m17 redemption codes, real-name pass and plugin pages', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('赛时通过率同一屏只有一个 primary', () => {
    const body = functionBody(readSource(REALPASS), 'RealPassManagePage');
    const labels = primaryButtonLabels(body);
    expect(labels.length, labels.join('、')).toBeLessThan(2);
  });

  it('页面结构 redemption-manage.tsx', () => {
    expectPageStructure(REDEMPTION, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('页面结构 realpass-manage.tsx', () => {
    expectPageStructure(REALPASS, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 plugin-pages.tsx', () => {
    expectPageStructure(PLUGINS, {
      widths: ['form', 'full'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('兑换码标题从 h1 移到 AdminPage title，且不再使用 Page 或 PageHeader', () => {
    const src = readSource(REDEMPTION);
    const pages = findOpenTags(src, 'AdminPage');
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.some((tag) => tag.text.includes('兑换码'))).toBe(true);
    expect(findOpenTags(src, 'h1').length).toBe(0);
    expect(findOpenTags(src, 'Page').length).toBe(0);
    expect(findOpenTags(src, 'PageHeader').length).toBe(0);
  });

  it('赛时通过率管理使用 Page width="wide" 与 PageHeader', () => {
    const body = functionBody(readSource(REALPASS), 'RealPassManagePage');
    expect(body.length).toBeGreaterThan(0);
    const pages = findOpenTags(body, 'Page');
    expect(pages.some((tag) => quotedAttr(tag.text, 'width', 'wide'))).toBe(true);
    expect(headerCarries(body, '赛时通过率管理')).toBe(true);
    expect(findOpenTags(body, 'h1').length).toBe(0);
  });

  it('赛时通过率表格的 ScrollArea 限制在 max-h-80，并用块级视口承接横向滚动', () => {
    const tags = findOpenTags(readSource(REALPASS), 'ScrollArea');
    const hit = tags.some((tag) => tag.text.includes('max-h-80') && quotedAttr(tag.text, 'viewportLayout', 'block'));
    expect(hit).toBe(true);
  });

  it('fps 导入页使用 Page width="form"', () => {
    const body = functionBody(readSource(PLUGINS), 'FpsImportPage');
    expect(body.length).toBeGreaterThan(0);
    const root = returnedOpenTag(body);
    expect(isTag(root, 'Page')).toBe(true);
    expect(quotedAttr(root, 'width', 'form')).toBe(true);
  });

  it('telegram 登录页在应用壳内使用 Page width="form"，不做全屏居中', () => {
    const body = functionBody(readSource(PLUGINS), 'TelegramLoginPage');
    expect(body.length).toBeGreaterThan(0);
    const root = returnedOpenTag(body);
    expect(isTag(root, 'Page')).toBe(true);
    expect(quotedAttr(root, 'width', 'form')).toBe(true);
    expect(findOpenTags(body, 'Page').length).toBeGreaterThan(0);
    expect(findOpenTags(body, 'h1').length).toBe(0);
    expect(body).not.toMatch(/\bmin-h-dvh\b/);
    expect(body).not.toMatch(/\bplace-items-center\b/);
    expect(findOpenTags(body, 'Panel').length).toBeGreaterThan(0);
    expect(headerCarries(body, '使用 Telegram 登录')).toBe(true);
  });

  it('xcpcio 榜单外层是 Page width="full"，并删除满高写法', () => {
    const body = functionBody(readSource(PLUGINS), 'XcpcioBoardPage');
    expect(body.length).toBeGreaterThan(0);
    const root = returnedOpenTag(body);
    expect(isTag(root, 'Page')).toBe(true);
    expect(quotedAttr(root, 'width', 'full')).toBe(true);
    expect(body).not.toMatch(/100d?vh/);
    expect(body).not.toMatch(/\b(?:min-)?h-(?:screen|dvh)\b/);
    expect(headerCarries(body, 'XCPCIO 榜单')).toBe(true);
    expect(findOpenTags(body, 'h1').length).toBe(0);
  });
});
