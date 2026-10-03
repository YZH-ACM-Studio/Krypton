export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface SizeLike {
  width: number;
  height: number;
}

interface ViewportLike {
  width: number;
  height: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  side: TooltipSide;
}

export interface AnchoredPopoverBox {
  left: number;
  width: number;
  maxHeight: number;
  side: 'top' | 'bottom';
  top?: number;
  bottom?: number;
}

const oppositeSide: Record<TooltipSide, TooltipSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function calculateTooltipPosition(
  trigger: RectLike,
  content: SizeLike,
  preferredSide: TooltipSide,
  sideOffset: number,
  viewport: ViewportLike,
  viewportPadding = 8,
): TooltipPosition {
  const available: Record<TooltipSide, number> = {
    top: trigger.top,
    bottom: viewport.height - trigger.bottom,
    left: trigger.left,
    right: viewport.width - trigger.right,
  };
  const required =
    preferredSide === 'left' || preferredSide === 'right'
      ? content.width + sideOffset + viewportPadding
      : content.height + sideOffset + viewportPadding;
  const opposite = oppositeSide[preferredSide];
  const side = available[preferredSide] < required && available[opposite] > available[preferredSide] ? opposite : preferredSide;

  let left = trigger.left + trigger.width / 2 - content.width / 2;
  let top = trigger.top + trigger.height / 2 - content.height / 2;

  if (side === 'right') left = trigger.right + sideOffset;
  if (side === 'left') left = trigger.left - sideOffset - content.width;
  if (side === 'bottom') top = trigger.bottom + sideOffset;
  if (side === 'top') top = trigger.top - sideOffset - content.height;

  const maxLeft = Math.max(viewportPadding, viewport.width - content.width - viewportPadding);
  const maxTop = Math.max(viewportPadding, viewport.height - content.height - viewportPadding);

  return {
    left: clamp(Math.round(left), viewportPadding, maxLeft),
    top: clamp(Math.round(top), viewportPadding, maxTop),
    side,
  };
}

export type AnchoredPlacement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top';

const POPOVER_VIEWPORT_PADDING = 8;

/**
 * Horizontal alignment for a box from `calculateAnchoredPopoverBox`.
 * `bottom-end` pins the floating layer's right edge to the anchor; every
 * placement is then clipped 8px inside the viewport. Other fields are copied.
 */
export function alignAnchoredBox<T extends { left: number }>(
  box: T,
  anchorRect: { readonly left: number; readonly right: number },
  floatingWidth: number,
  placement: AnchoredPlacement,
  viewportWidth: number,
): T {
  const unclamped = placement === 'bottom-end' ? anchorRect.right - floatingWidth : box.left;
  const maxLeft = Math.max(
    POPOVER_VIEWPORT_PADDING,
    viewportWidth - POPOVER_VIEWPORT_PADDING - floatingWidth,
  );
  return {
    ...box,
    left: clamp(unclamped, POPOVER_VIEWPORT_PADDING, maxLeft),
  };
}

/** Place a portaled menu against a trigger, flipping on short remaining viewport. */
export function calculateAnchoredPopoverBox(
  trigger: RectLike,
  viewport: ViewportLike,
  options: { gap?: number; padding?: number } = {},
): AnchoredPopoverBox {
  const gap = options.gap ?? 4;
  const padding = options.padding ?? 8;
  const spaceBelow = viewport.height - trigger.bottom - gap;
  const spaceAbove = trigger.top - gap;
  const side: 'top' | 'bottom' = spaceBelow >= spaceAbove ? 'bottom' : 'top';
  const maxHeight = Math.max(0, side === 'bottom' ? spaceBelow : spaceAbove);
  const width = Math.max(0, Math.min(trigger.width, Math.max(0, viewport.width - padding * 2)));
  const left = clamp(trigger.left, padding, Math.max(padding, viewport.width - width - padding));
  if (side === 'bottom') {
    return { left, width, maxHeight, side, top: trigger.bottom + gap };
  }
  return { left, width, maxHeight, side, bottom: viewport.height - trigger.top + gap };
}
