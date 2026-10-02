/**
 * Native checkbox with role="switch". The thumb moves with CSS `translate`
 * on `peer-checked`, not motion: the input may be uncontrolled. `className`
 * lands on the wrapping span. `md` track is 20×36 with a 16px thumb;
 * `sm` is 16×28 with a 12px thumb.
 */
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
  /** Called with the new boolean state, before the standard onChange. */
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(({
  className,
  size = 'md',
  onCheckedChange,
  onChange,
  disabled,
  ...props
}, forwardedRef) => {
  const sm = size === 'sm';

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full p-0.5 align-middle',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
        sm ? 'h-4 w-7' : 'h-5 w-9',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
        className,
      )}
    >
      <input
        ref={forwardedRef}
        disabled={disabled}
        className="peer absolute inset-0 m-0 size-full cursor-inherit opacity-0"
        onChange={(event) => {
          onCheckedChange?.(event.currentTarget.checked);
          onChange?.(event);
        }}
        {...props}
        type="checkbox"
        role="switch"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full bg-line-strong transition-colors duration-(--dur-1) ease-(--ease-standard) peer-checked:bg-brand"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none relative block rounded-full bg-white shadow-sm',
          'transition-transform duration-(--dur-2) ease-(--ease-out)',
          sm ? 'size-3 peer-checked:translate-x-3' : 'size-4 peer-checked:translate-x-4',
        )}
      />
    </span>
  );
});
