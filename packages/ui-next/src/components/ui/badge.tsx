import type * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange';

type CanonicalVariant = 'soft' | 'outline' | 'solid';
type LegacyVariant = 'default' | 'secondary' | 'destructive';
type BadgeVariant = CanonicalVariant | LegacyVariant;

const softTone: Record<BadgeTone, string> = {
  neutral: 'bg-surface-active text-fg-muted',
  brand: 'bg-brand-soft text-brand-fg',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
  violet: 'bg-violet-soft text-violet-fg',
  orange: 'bg-orange-soft text-orange-fg',
};

const outlineTone: Record<BadgeTone, string> = {
  neutral: 'border-line-strong text-fg-muted',
  brand: 'border-brand-line text-brand-fg',
  success: 'border-success-line text-success-fg',
  warning: 'border-warning-line text-warning-fg',
  danger: 'border-danger-line text-danger-fg',
  info: 'border-info-line text-info-fg',
  violet: 'border-violet-line text-violet-fg',
  orange: 'border-orange-line text-orange-fg',
};

const solidTone: Record<BadgeTone, string> = {
  neutral: 'bg-fg text-bg',
  brand: 'bg-brand text-on-brand',
  success: 'bg-success text-on-success',
  warning: 'bg-warning text-on-warning',
  danger: 'bg-danger text-on-danger',
  info: 'bg-info text-on-info',
  violet: 'bg-violet text-white',
  orange: 'bg-orange text-white',
};

const dotTone: Record<BadgeTone, string> = {
  neutral: 'bg-fg-subtle',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  violet: 'bg-violet',
  orange: 'bg-orange',
};

const badgeSize = cva('inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium tabular', {
  variants: {
    size: {
      sm: 'h-4.5 rounded-sm px-1.5 text-2xs',
      md: 'h-5.5 rounded-sm px-2 text-xs',
    },
  },
  defaultVariants: { size: 'md' },
});

const LEGACY_TONE: Record<LegacyVariant, BadgeTone> = {
  default: 'brand',
  secondary: 'neutral',
  destructive: 'danger',
};

export interface BadgeProps extends React.ComponentProps<'span'> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
}

function isLegacyVariant(variant: BadgeVariant): variant is LegacyVariant {
  return variant === 'default' || variant === 'secondary' || variant === 'destructive';
}

/** Legacy names pick the tone. Outline keeps an explicit tone, otherwise neutral. */
function resolveBadge(tone: BadgeTone | undefined, variant: BadgeVariant | undefined): { tone: BadgeTone; variant: CanonicalVariant } {
  if (variant != null && isLegacyVariant(variant)) {
    return { tone: LEGACY_TONE[variant], variant: 'soft' };
  }
  if (variant === 'outline') {
    return { tone: tone ?? 'neutral', variant: 'outline' };
  }
  return { tone: tone ?? 'neutral', variant: variant ?? 'soft' };
}

function toneClass(tone: BadgeTone, variant: CanonicalVariant): string {
  if (variant === 'soft') {
    return softTone[tone];
  }
  if (variant === 'solid') {
    return solidTone[tone];
  }
  return cn('border', outlineTone[tone]);
}

export function Badge({
  className, tone, variant, size, dot, children, ...props
}: BadgeProps) {
  const resolved = resolveBadge(tone, variant);
  return (
    <span
      {...props}
      data-slot="badge"
      data-tone={resolved.tone}
      data-variant={resolved.variant}
      className={cn(badgeSize({ size: size ?? 'md' }), toneClass(resolved.tone, resolved.variant), className)}
    >
      {dot ? (
        <span className={cn('size-1.5 rounded-full', resolved.variant === 'solid' ? 'bg-current' : dotTone[resolved.tone])} />
      ) : null}
      {children}
    </span>
  );
}
