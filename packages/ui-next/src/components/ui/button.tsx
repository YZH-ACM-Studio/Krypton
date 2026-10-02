import type * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariantClass = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)',
    'active:scale-[.97] disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-on-brand shadow-xs hover:bg-brand-hover',
        secondary: 'border border-line bg-surface text-fg shadow-xs hover:border-line-strong hover:bg-surface-hover',
        soft: 'bg-brand-soft text-brand-fg hover:bg-brand-soft-hover',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        danger: 'bg-danger text-on-danger shadow-xs hover:bg-danger-hover',
        'danger-soft': 'bg-danger-soft text-danger-fg hover:bg-danger-soft-hover',
        link: 'h-auto! px-0! text-brand-fg underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        sm: 'h-(--control-sm) px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-(--control-md) px-3.5 text-sm [&_svg]:size-4',
        lg: 'h-(--control-lg) px-5 text-md [&_svg]:size-4.5',
      },
      iconOnly: {
        true: 'px-0',
        false: '',
      },
    },
    compoundVariants: [
      { size: 'sm', iconOnly: true, class: 'w-(--control-sm)' },
      { size: 'md', iconOnly: true, class: 'w-(--control-md)' },
      { size: 'lg', iconOnly: true, class: 'w-(--control-lg)' },
    ],
    // Omitted variant stays primary until every call site passes variant.
    defaultVariants: { variant: 'primary', size: 'md', iconOnly: false },
  },
);

type CanonicalVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'danger-soft' | 'link';
type LegacyVariant = 'default' | 'outline' | 'destructive';
type ButtonVariant = CanonicalVariant | LegacyVariant;
type CanonicalSize = 'sm' | 'md' | 'lg';
type ButtonSize = CanonicalSize | 'default' | 'icon';

const LEGACY_VARIANT: Record<LegacyVariant, CanonicalVariant> = {
  default: 'primary',
  outline: 'secondary',
  destructive: 'danger',
};

function isLegacyVariant(variant: ButtonVariant): variant is LegacyVariant {
  return variant === 'default' || variant === 'outline' || variant === 'destructive';
}

/** Missing variant is primary for the compatibility window, not the spec default secondary. */
function canonicalVariant(variant: ButtonVariant | null | undefined): CanonicalVariant {
  if (variant == null) {
    return 'primary';
  }
  if (isLegacyVariant(variant)) {
    return LEGACY_VARIANT[variant];
  }
  return variant;
}

/** `icon` is a square md control. `default` is md and does not force iconOnly. */
function canonicalSize(size: ButtonSize | null | undefined, iconOnly: boolean | null | undefined): { size: CanonicalSize; iconOnly: boolean } {
  if (size === 'icon') {
    return { size: 'md', iconOnly: true };
  }
  return {
    size: size == null || size === 'default' ? 'md' : size,
    iconOnly: iconOnly === true,
  };
}

export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  asChild?: boolean;
  /** Spinner, aria-busy, and blocked clicks. Ignored together with asChild. Width stays put. */
  loading?: boolean;
}

export function buttonVariants(options?: { variant?: ButtonVariant | null; size?: ButtonSize | null; iconOnly?: boolean | null }): string {
  const variant = canonicalVariant(options?.variant);
  const resolved = canonicalSize(options?.size, options?.iconOnly);
  return buttonVariantClass({ variant, size: resolved.size, iconOnly: resolved.iconOnly });
}

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={cn('size-4 animate-[kr-spin_.7s_linear_infinite]', className)} {...props}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Button({ className, variant, size, iconOnly, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const showLoading = loading && !asChild;
  const resolvedVariant = canonicalVariant(variant);
  const resolvedSize = canonicalSize(size, iconOnly);
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      {...props}
      data-slot="button"
      data-variant={resolvedVariant}
      data-size={resolvedSize.size}
      aria-busy={showLoading ? true : props['aria-busy']}
      disabled={showLoading ? true : disabled}
      className={cn(
        buttonVariants({ variant: resolvedVariant, size: resolvedSize.size, iconOnly: resolvedSize.iconOnly }),
        showLoading && 'opacity-100!',
        className,
      )}
    >
      {showLoading ? (
        <>
          <Spinner className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2" />
          <span className="inline-flex items-center gap-1.5 opacity-0">{children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

/** Horizontal group: buttons share borders, only the ends are rounded. */
export function ButtonGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      role="group"
      className={cn(
        'inline-flex items-stretch [&>*]:rounded-none [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md [&>*+*]:-ml-px [&>*:focus-visible]:z-10',
        className,
      )}
    />
  );
}
