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
    expect(router).to.match(/<header className="[^"]*\bmin-w-0\b/);
    expect(router).to.include('aria-label="打开菜单"');
    expect(router).to.match(/<span className="[^"]*\btruncate\b[^"]*">\{bs\.domain\.name\}<\/span>/);
    expect(router).to.match(/<div className="flex min-w-0 items-center gap-1\.5">/);
    expect(router).to.include('relative hidden size-8 sm:inline-flex');
    expect(router).to.include('hidden size-8 sm:inline-flex');
    expect(router).to.include('px-3 py-2.5 text-sm hover:bg-accent sm:py-1.5');
    expect(router).to.include('px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 sm:py-1.5');
  });

  it('pins the announcement popover to the viewport instead of a 360px absolute box', () => {
    const popover = source('packages/ui-next/src/components/announcement-popover.tsx');
    expect(popover).not.to.include('w-[360px]');
    expect(popover).not.to.match(/className="absolute right-0 top-full/);
    expect(popover).to.include('fixed right-3');
    expect(popover).to.include('w-[min(360px,calc(100vw-1.5rem))]');
    expect(popover).to.include('max-h-[min(28rem,calc(100dvh-4.5rem))]');
  });

  it('uses a 44px mobile drawer close target and auto scrollbars', () => {
    const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
    expect(sidebar).to.include('size-8 min-h-11 min-w-11 md:hidden');
    expect(sidebar).to.include("type={scrollType}");
    expect(sidebar).to.include("{renderSidebarContent(false, 'auto')}");
    expect(sidebar).to.include("{renderSidebarContent(collapsed)}");
  });

  it('lets the page ScrollArea own scrolling instead of iOS html/body rubber-banding', () => {
    const css = source('packages/ui-next/src/styles.css');
    const router = source('packages/ui-next/src/router.tsx');
    expect(css).to.match(/html,\s*body,\s*#root/);
    expect(css).to.include('height: 100%');
    expect(css).to.include('overflow: hidden');
    expect(css).not.to.include('min-height: 100vh');
    expect(css).not.to.match(/html\s*\{[^}]*overflow-x:\s*hidden/);
    expect(router).to.include('flex h-full min-h-0 min-w-0 overflow-hidden bg-background');
    expect(router).to.include('data-scroll-owner="page"');
    expect(router).to.include('className="min-h-0 min-w-0 flex-1"');
    expect(router).to.include('pb-[env(safe-area-inset-bottom)]');
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
    const redeem = source('packages/ui-next/src/components/redeem-dialog.tsx');
    const footer = source('packages/ui-next/src/components/layout/footer.tsx');
    const html = source('packages/ui-next/index.html');
    expect(redeem).to.include('className="text-base md:text-sm"');
    expect(footer).to.include('min-w-0 space-y-1 break-words');
    expect(footer).to.include('inline-flex min-h-11 items-center hover:text-foreground sm:min-h-0');
    expect(html).to.include('viewport-fit=cover');
  });
});
