/**
 * Switch — branded replacement for a boolean `<input type="checkbox">`.
 *
 * Layout: a sr-only native checkbox with `role="switch"` + two siblings styled
 * via Tailwind's `peer-*` modifiers. The native input still posts in forms,
 * takes focus, is toggled by a wrapping `<label>`, and supports `name` /
 * `value` / `defaultChecked` / `checked` / `required` / `disabled` /
 * `onChange` exactly like `Checkbox`.
 *
 * Visual sibling 1 (track) — the rounded pill. Primary when `:checked`,
 * muted when off.
 * Visual sibling 2 (thumb) — the white knob that slides on `:checked`.
 *
 * Both siblings come AFTER the input in DOM order so `peer-checked:` and
 * `peer-focus-visible:` resolve correctly.
 *
 * Supports an optional `onCheckedChange(checked)` callback in addition to
 * the standard `onChange(event)` — the convenience matches Radix's API.
 *
 * Use `<Switch size="sm" />` for the dense 4×7 variant; default 5×9 elsewhere.
 */
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
  /** Called with the new boolean state, alongside the standard onChange. */
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, size = 'md', onCheckedChange, onChange, disabled, ...props }, forwardedRef) => {
    const track = size === 'sm' ? 'h-4 w-7' : 'h-5 w-9';
    const thumb = size === 'sm'
      ? 'size-3 translate-x-0.5 peer-checked:translate-x-3.5'
      : 'size-3.5 translate-x-0.75 peer-checked:translate-x-4.5';

    return (
      <span
        className={cn(
          'relative inline-flex shrink-0 items-center align-middle',
          track,
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          className,
        )}
      >
        <input
          ref={forwardedRef}
          disabled={disabled}
          className="peer absolute inset-0 m-0 size-full cursor-inherit opacity-0"
          onChange={(e) => {
            onCheckedChange?.(e.currentTarget.checked);
            onChange?.(e);
          }}
          {...props}
          type="checkbox"
          role="switch"
        />
        <span
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full transition-colors',
            'bg-muted-foreground/30 peer-checked:bg-primary',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background',
          )}
        />
        <span
          className={cn(
            'pointer-events-none rounded-full bg-white shadow transition-transform',
            thumb,
          )}
        />
      </span>
    );
  },
);
