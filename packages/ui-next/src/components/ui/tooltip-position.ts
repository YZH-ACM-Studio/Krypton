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
