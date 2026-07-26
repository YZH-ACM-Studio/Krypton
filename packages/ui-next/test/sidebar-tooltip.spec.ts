import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateTooltipPosition } from '../src/components/ui/tooltip-position.ts';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe('sidebar tooltip positioning', () => {
  it('places a right-side tooltip outside the collapsed rail', () => {
    const position = calculateTooltipPosition(rect(16, 40, 44, 44), { width: 96, height: 40 }, 'right', 8, {
      width: 320,
      height: 200,
    });

    expect(position).to.deep.equal({ left: 68, top: 42, side: 'right' });
  });

  it('flips away from a blocked edge and clamps inside the viewport', () => {
    const flipped = calculateTooltipPosition(rect(260, 40, 44, 44), { width: 100, height: 40 }, 'right', 8, {
      width: 320,
      height: 200,
    });
    const clamped = calculateTooltipPosition(rect(16, 170, 44, 28), { width: 96, height: 40 }, 'right', 8, {
      width: 320,
      height: 200,
    });

    expect(flipped).to.deep.equal({ left: 152, top: 42, side: 'left' });
    expect(clamped).to.deep.equal({ left: 68, top: 152, side: 'right' });
  });
});

describe('collapsed sidebar interaction contracts', () => {
  const tooltip = readFileSync(resolve(workspaceRoot, 'packages/ui-next/src/components/ui/tooltip.tsx'), 'utf8');
  const sidebar = readFileSync(resolve(workspaceRoot, 'packages/ui-next/src/components/layout/sidebar.tsx'), 'utf8');

  it('portals floating content beyond scroll-area clipping', () => {
    expect(tooltip).to.include('createPortal');
    expect(tooltip).to.include("position: 'fixed'");
    expect(tooltip).to.include("document.addEventListener('scroll'");
    expect(tooltip).to.include("document.addEventListener('keydown'");
    expect(tooltip).to.include('hovered.current');
    expect(tooltip).to.include('focused.current');
  });

  it('keeps collapsed navigation targets accessible and deliberately animated', () => {
    expect(sidebar).to.include('size-11');
    expect(sidebar).to.include('min-h-11');
    expect(sidebar).to.include('md:min-h-10');
    expect(sidebar).to.include("aria-current={active ? 'page' : undefined}");
    expect(sidebar).to.include('delayDuration={160}');
    expect(sidebar).to.include('const COLLAPSED_TOOLTIP_OFFSET = 18');
    expect(sidebar).to.include('sideOffset={COLLAPSED_TOOLTIP_OFFSET}');
    expect(sidebar).to.include('{renderSidebarContent(false)}');
    expect(sidebar).not.to.include('transition-all');
  });
});
