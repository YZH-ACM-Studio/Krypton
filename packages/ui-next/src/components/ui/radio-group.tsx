/**
 * RadioGroup — branded replacement for the native `<input type="radio">`.
 *
 * Same approach as `Checkbox` (sr-only input + styled visual sibling), but a
 * round outline and a filled dot when selected. Use exactly like a native
 * radio for form submission — the underlying input still has `name` and
 * `value`.
 *
 * Group together by sharing the same `name`. Each `RadioGroupItem` is an
 * inline-block; wrap them in a flex/grid container as needed.
 *
 * Used by the SendMessageDialog ("info / warning / critical" + audience).
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface RadioGroupItemProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
  label?: ReactNode;
  description?: ReactNode;
  /** Class on the wrapping <label>. */
  wrapperClassName?: string;
}

export const RadioGroupItem = forwardRef<HTMLInputElement, RadioGroupItemProps>(
  function RadioGroupItem(
    {
      size = 'md', label, description, wrapperClassName, className, disabled,
      id: idProp, ...props
    },
    ref,
  ) {
    const fallbackId = useId();
    const id = idProp || fallbackId;
    const dim = size === 'sm' ? 'size-3.5' : 'size-4';
    const dotDim = size === 'sm' ? 'size-1.5' : 'size-2';
    return (
      <label
        htmlFor={id}
        className={cn(
          'inline-flex items-start gap-2',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          wrapperClassName,
        )}
      >
        <span className={cn('relative inline-flex shrink-0 translate-y-0.5', dim)}>
          <input
            ref={ref}
            id={id}
            type="radio"
            disabled={disabled}
            className={cn('peer absolute inset-0 m-0 size-full cursor-inherit opacity-0', className)}
            {...props}
          />
          <span
            className={cn(
              'pointer-events-none block size-full rounded-full border bg-background transition-colors',
              'border-input',
              'peer-checked:border-primary',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background',
            )}
          />
          <span
            className={cn(
              'pointer-events-none absolute inset-0 m-auto rounded-full bg-primary opacity-0 transition-opacity peer-checked:opacity-100',
              dotDim,
            )}
          />
        </span>
        {(label || description) && (
          <span className="flex flex-col gap-0.5">
            {label && <span className="text-sm text-foreground">{label}</span>}
            {description && <span className="text-xs text-muted-foreground">{description}</span>}
          </span>
        )}
      </label>
    );
  },
);

interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Orientation of the items. */
  orientation?: 'horizontal' | 'vertical';
}

export function RadioGroup({
  orientation = 'vertical', className, ...props
}: RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'flex',
        orientation === 'horizontal' ? 'flex-row flex-wrap gap-4' : 'flex-col gap-2',
        className,
      )}
      {...props}
    />
  );
}
