import type * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Kbd } from './display';

export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  invalid?: boolean;
}

type ControlSize = NonNullable<InputProps['size']>;

const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: 'h-(--control-sm)',
  md: 'h-(--control-md)',
  lg: 'h-(--control-lg)',
};

const CONTROL_TEXT: Record<ControlSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-md',
};

const FIELD_CHROME = [
  'w-full min-w-0 rounded-md border border-line-strong bg-surface text-fg shadow-xs',
  'hover:border-fg-disabled',
  'aria-invalid:border-danger',
  'transition-[border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard)',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-disabled',
  'has-disabled:cursor-not-allowed has-disabled:bg-surface-sunken has-disabled:text-fg-disabled',
].join(' ');

const BARE_FOCUS = 'focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:focus-visible:ring-danger/25';

const SHELL_FOCUS = 'focus-within:border-brand focus-within:outline-none focus-within:ring-3 focus-within:ring-ring/40 aria-invalid:focus-within:ring-danger/25';

function isAdornment(node: React.ReactNode): boolean {
  return node != null && node !== false;
}

function resolvedAriaInvalid(
  invalid: boolean | undefined,
  caller: React.AriaAttributes['aria-invalid'],
): React.AriaAttributes['aria-invalid'] {
  if (caller !== undefined) {
    return caller;
  }
  if (invalid) {
    return true;
  }
  return undefined;
}

function Adornment({ children }: { children: React.ReactNode }) {
  return <span className="flex shrink-0 items-center text-fg-subtle [&_svg]:size-4">{children}</span>;
}

export function Input({
  className,
  size = 'md',
  leading,
  trailing,
  invalid,
  type,
  ref,
  ...props
}: InputProps) {
  const ariaInvalid = resolvedAriaInvalid(invalid, props['aria-invalid']);
  const numeric = type === 'number';
  const adorned = isAdornment(leading) || isAdornment(trailing);

  // Bare controls stay a single input so className, ref, and attributes land on it.
  // Adorned controls move className to the shell; ref and attributes stay on the input.
  if (!adorned) {
    return (
      <input
        {...props}
        ref={ref}
        data-slot="input"
        type={type}
        aria-invalid={ariaInvalid}
        className={cn(
          FIELD_CHROME,
          BARE_FOCUS,
          'px-2.5 placeholder:text-fg-subtle',
          CONTROL_HEIGHT[size],
          CONTROL_TEXT[size],
          numeric && 'tabular',
          className,
        )}
      />
    );
  }

  return (
    <div
      data-slot="input-shell"
      aria-invalid={ariaInvalid}
      className={cn(
        FIELD_CHROME,
        SHELL_FOCUS,
        'flex items-center gap-2 px-2.5',
        CONTROL_HEIGHT[size],
        CONTROL_TEXT[size],
        className,
      )}
    >
      {isAdornment(leading) ? <Adornment>{leading}</Adornment> : null}
      <input
        {...props}
        ref={ref}
        data-slot="input"
        type={type}
        aria-invalid={ariaInvalid}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle',
          'disabled:cursor-not-allowed disabled:text-fg-disabled',
          CONTROL_TEXT[size],
          numeric && 'tabular',
        )}
      />
      {isAdornment(trailing) ? <Adornment>{trailing}</Adornment> : null}
    </div>
  );
}

export function SearchInput({ shortcut, leading, trailing, ...props }: InputProps & { shortcut?: string }) {
  const shortcutKey = shortcut != null && shortcut !== '' ? <Kbd>{shortcut}</Kbd> : null;
  return (
    <Input
      {...props}
      type="search"
      leading={isAdornment(leading) ? leading : <Search />}
      trailing={trailing === undefined ? shortcutKey : trailing}
    />
  );
}
