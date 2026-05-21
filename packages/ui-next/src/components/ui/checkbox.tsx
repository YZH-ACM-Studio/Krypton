/**
 * Checkbox — branded replacement for the native `<input type="checkbox">`.
 *
 * Layout: a sr-only native checkbox + two siblings styled via Tailwind's
 * `peer-*` modifiers. The native input still posts in forms, takes focus,
 * announces correctly to screen readers, and supports `name` / `value` /
 * `defaultChecked` / `required` / `disabled` exactly like the original.
 *
 * Visual sibling 1 (.box) — the rounded border square that fills with the
 * primary colour when :checked.
 * Visual sibling 2 (.check) — the Lucide `Check` icon, fades in on :checked.
 *
 * Both siblings come AFTER the input in DOM order so `peer-checked:` and
 * `peer-focus-visible:` resolve correctly.
 *
 * Supports an optional `onCheckedChange(checked)` callback in addition to
 * the standard `onChange(event)` — the convenience matches Radix's API.
 *
 * Use `<Checkbox size="sm" />` for the dense 3.5×3.5 variant inside table
 * cells; default 4×4 elsewhere.
 *
 * The optional `indeterminate` prop wires the DOM property + swaps the
 * check glyph for a minus.
 */
import { Check, Minus } from 'lucide-react';
import { forwardRef, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
  indeterminate?: boolean;
  /** Called with the new boolean state, alongside the standard onChange. */
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    className, size = 'md', indeterminate, onCheckedChange, onChange,
    disabled, ...props
  },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mirror the indeterminate DOM property since React doesn't have an attribute for it.
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = !!indeterminate;
  }, [indeterminate, props.checked, props.defaultChecked]);

  const dim = size === 'sm' ? 'size-3.5' : 'size-4';
  const iconDim = size === 'sm' ? 'size-2.5' : 'size-3';

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 align-middle',
        dim,
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input
        ref={(el) => {
          inputRef.current = el;
          if (typeof forwardedRef === 'function') forwardedRef(el);
          else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }}
        type="checkbox"
        disabled={disabled}
        className="peer absolute inset-0 m-0 size-full cursor-inherit opacity-0"
        onChange={(e) => {
          onCheckedChange?.(e.currentTarget.checked);
          onChange?.(e);
        }}
        {...props}
      />
      {/* The visual square. Comes after the input so peer-* applies. */}
      <span
        className={cn(
          'pointer-events-none block size-full rounded-sm border bg-background transition-colors',
          'border-input',
          'peer-checked:border-primary peer-checked:bg-primary',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background',
          !disabled && 'group-hover:border-primary/60',
          indeterminate && 'border-primary bg-primary',
        )}
      />
      {/* The check / minus glyph. Centred via inset-0+m-auto. */}
      {indeterminate ? (
        <Minus
          className={cn(
            'pointer-events-none absolute inset-0 m-auto text-primary-foreground',
            iconDim,
          )}
          strokeWidth={3}
        />
      ) : (
        <Check
          className={cn(
            'pointer-events-none absolute inset-0 m-auto text-primary-foreground opacity-0 transition-opacity',
            'peer-checked:opacity-100',
            iconDim,
          )}
          strokeWidth={3}
        />
      )}
    </span>
  );
});
