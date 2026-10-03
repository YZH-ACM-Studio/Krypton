/**
 * Textarea — multi-line field with the same chrome as Input.
 */
import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const FIELD_CHROME = [
  'w-full min-w-0 rounded-md border border-line-strong bg-surface text-fg shadow-xs',
  'hover:border-fg-disabled',
  'aria-invalid:border-danger',
  'transition-[border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard)',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-disabled',
  'has-disabled:cursor-not-allowed has-disabled:bg-surface-sunken has-disabled:text-fg-disabled',
].join(' ');

const BARE_FOCUS = 'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:focus-visible:ring-danger/25';

function resolvedAriaInvalid(
  invalid: boolean | undefined,
  caller: TextareaHTMLAttributes<HTMLTextAreaElement>['aria-invalid'],
): TextareaHTMLAttributes<HTMLTextAreaElement>['aria-invalid'] {
  if (caller !== undefined) {
    return caller;
  }
  if (invalid) {
    return true;
  }
  return undefined;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, invalid, ...props }, ref) => {
  return (
    <textarea
      {...props}
      ref={ref}
      data-slot="textarea"
      aria-invalid={resolvedAriaInvalid(invalid, props['aria-invalid'])}
      className={cn(
        FIELD_CHROME,
        BARE_FOCUS,
        'min-h-20 resize-y px-2.5 py-2 text-sm placeholder:text-fg-subtle',
        className,
      )}
    />
  );
});
