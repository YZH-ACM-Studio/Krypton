/**
 * Shared narrow-viewport gate for the messages workbench.
 *
 * JS `matchMedia` and CSS must use the same condition: phone width
 * (`max-width: 767px`, Tailwind `max-md`) OR short height (`max-height: 540px`).
 * Dual-pane is the complement: min-width 768px AND min-height 541px.
 */

export const NARROW_QUERY = '(max-width: 767px), (max-height: 540px)';

const NARROW_TW_VARIANTS = ['max-md', '[@media(max-height:540px)]'] as const;

export const DUAL_PANE_TW = '[@media(min-width:768px)_and_(min-height:541px)]';

export function narrowTw(utility: string): string {
  return NARROW_TW_VARIANTS.map((variant) => `${variant}:${utility}`).join(' ');
}

export function dualPaneTw(utility: string): string {
  return `${DUAL_PANE_TW}:${utility}`;
}
