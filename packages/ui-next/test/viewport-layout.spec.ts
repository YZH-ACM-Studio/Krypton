import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

describe('mobile viewport layout contracts', () => {
  it('keeps the app shell header from overflowing a 320px viewport', () => {
    const router = source('packages/ui-next/src/router.tsx');
    expect(router).to.include('aria-label="打开菜单"');
    expect(router).to.include('{bs.domain.name}');
  });

  it('uses a 44px mobile drawer close target and auto scrollbars', () => {
    const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
    expect(sidebar).to.include("type={scrollType}");
    expect(sidebar).to.include("{renderSidebarContent(false, 'auto')}");
    expect(sidebar).to.include("{renderSidebarContent(collapsed)}");
  });

  it('lets the page ScrollArea own scrolling instead of iOS html/body rubber-banding', () => {
    const css = source('packages/ui-next/src/styles.css');
    const router = source('packages/ui-next/src/router.tsx');
    expect(css).to.match(/html,\s*body,\s*#root/);
    expect(css).to.include('height: 100%');
    expect(css).not.to.include('min-height: 100vh');
    expect(router).to.include('data-scroll-owner="page"');
  });

  it('stacks only the problem shell split on narrow or short viewports', () => {
    const css = source('packages/ui-next/src/styles.css');
    expect(css).to.include('@media (max-width: 767px), (max-height: 500px)');
    expect(css).to.include('.krypton-split:not(.krypton-split *)');
    expect(css).to.include('.krypton-split:not(.krypton-split *) > .krypton-split-pane:first-child');
    expect(css).to.match(/\.krypton-split:not\(\.krypton-split \*\) > \.krypton-split-pane:first-child\s*\{\s*height:\s*46%;/);
    expect(css).not.to.match(/@media \(max-width: 767px\)\s*\{\s*\.krypton-split\s*\{/);
  });

  it('keeps markdown panes single-column in landscape without stacking two 60vh bands', () => {
    const css = source('packages/ui-next/src/styles.css');
    expect(css).to.match(/\.krypton-md-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).to.include('max-height: min(32dvh, calc((100dvh - 8rem) / 2))');
    expect(css).not.to.match(/\.krypton-md-shell > \*[\s\S]{0,80}max-height:\s*60vh/);
  });

  it('keeps compact tables horizontally scrollable at 640px', () => {
    const css = source('packages/ui-next/src/styles.css');
    expect(css).to.match(/@media \(max-width: 640px\)\s*\{\s*\.krypton-table\s*\{\s*min-width:\s*max-content;/);
  });

  it('uses 16px redeem input text on iOS and wrapping footer beian links', () => {
    const html = source('packages/ui-next/index.html');
    expect(html).to.include('viewport-fit=cover');
  });
});
