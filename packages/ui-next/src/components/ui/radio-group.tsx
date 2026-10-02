/**
 * Native radio. Items that share `name` group themselves. `className` stays
 * on the input; `wrapperClassName` is the label. The dot scales with
 * `peer-checked` so an uncontrolled input still animates.
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '@/lib/cn';

export interface RadioGroupItemProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
  label?: ReactNode;
  description?: ReactNode;
  /** Class on the wrapping <label>. */
  wrapperClassName?: string;
}

export const RadioGroupItem = forwardRef<HTMLInputElement, RadioGroupItemProps>(({
  size = 'md',
  label,
  description,
  wrapperClassName,
  className,
  disabled,
  id: idProp,
  ...props
}, ref) => {
  const fallbackId = useId();
  const id = idProp || fallbackId;
  const dim = size === 'sm' ? 'size-3.5' : 'size-4';
  const dotDim = size === 'sm' ? 'size-1.5' : 'size-2';

  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex items-start gap-2.5',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
        wrapperClassName,
      )}
    >
      <span className={cn('relative inline-flex shrink-0 translate-y-0.5', dim)}>
        <input
          ref={ref}
          id={id}
          disabled={disabled}
          className={cn('peer absolute inset-0 m-0 size-full cursor-inherit opacity-0', className)}
          {...props}
          type="radio"
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none block size-full rounded-full border border-line-strong bg-surface shadow-xs',
            'transition-colors duration-(--dur-1) ease-(--ease-standard)',
            'peer-checked:border-brand',
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 m-auto scale-0 rounded-full bg-brand',
            'transition-transform duration-(--dur-2) ease-(--ease-out) peer-checked:scale-100',
            dotDim,
          )}
        />
      </span>
      {(label || description) && (
        <span className="flex flex-col gap-0.5">
          {label && <span className="text-sm text-fg">{label}</span>}
          {description && <span className="text-xs text-fg-subtle">{description}</span>}
        </span>
      )}
    </label>
  );
});

interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Orientation of the items. */
  orientation?: 'horizontal' | 'vertical';
}

export function RadioGroup({ orientation = 'vertical', className, ...props }: RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      className={cn('flex', orientation === 'horizontal' ? 'flex-row flex-wrap gap-4' : 'flex-col gap-2', className)}
      {...props}
    />
  );
}
