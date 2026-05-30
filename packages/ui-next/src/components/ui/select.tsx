/**
 * Select — branded single-value dropdown built on Radix.
 *
 * Replaces the native `<select>` everywhere. Two ways to use it:
 *
 *   1. Compound (matches shadcn / Radix shape):
 *        <Select name="rule" defaultValue="acm">
 *          <SelectTrigger><SelectValue placeholder="选择规则" /></SelectTrigger>
 *          <SelectContent>
 *            <SelectItem value="acm">ACM/ICPC</SelectItem>
 *            <SelectItem value="ioi">IOI</SelectItem>
 *          </SelectContent>
 *        </Select>
 *
 *   2. SimpleSelect (one-liner for most Krypton replacements):
 *        <SimpleSelect
 *          name="rule"
 *          defaultValue=""
 *          options={[
 *            { value: '', label: '不限' },
 *            { value: 'acm', label: 'ACM/ICPC' },
 *          ]}
 *          placeholder="选择规则"
 *        />
 *
 * Both render through a Portal, so they escape any `overflow-x-auto` /
 * `overflow-hidden` parent (which is what bit us with the IDE toolbar — see
 * CLAUDE.md 坑 13).
 *
 * Empty-string values:
 *   Radix Select treats `""` as "no selection" and forbids it on `<SelectItem
 *   value>`. Many Hydro forms genuinely want `value=""` to mean "all /
 *   不限". We work around this by mapping `""` → an internal sentinel inside
 *   the component, then mapping back when calling `onValueChange` and when
 *   writing the hidden form input.
 *
 *   Don't use the literal string `__EMPTY__` as a real option value — it
 *   collides with the sentinel.
 */
import * as React from 'react';
import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';

const EMPTY_VALUE = '__EMPTY__';
const toInternal = (v: string | undefined): string | undefined =>
  v === '' ? EMPTY_VALUE : v;
const fromInternal = (v: string): string => (v === EMPTY_VALUE ? '' : v);

/* ─── compound primitives ─── */

export interface SelectProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RSelect.Root>,
  'value' | 'defaultValue' | 'onValueChange' | 'name'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Hidden form input name (set to render a sibling `<input type="hidden">`). */
  name?: string;
}

/**
 * Compound root. Re-exports Radix `Select.Root` with two adjustments:
 *
 *   1. `value=""` is internally translated to a sentinel because Radix
 *      forbids empty-string values on items.
 *   2. We render our own `<input type="hidden">` for form submission rather
 *      than letting Radix do it — Radix would post the sentinel literal
 *      when the user picks the "empty / 不限" option.
 */
export function Select({
  value, defaultValue, onValueChange, name, children, ...props
}: SelectProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string>(defaultValue ?? '');
  const current = isControlled ? (value ?? '') : internal;
  return (
    <>
      <RSelect.Root
        value={toInternal(value)}
        defaultValue={toInternal(defaultValue)}
        onValueChange={(v) => {
          const real = fromInternal(v);
          if (!isControlled) setInternal(real);
          onValueChange?.(real);
        }}
        {...props}
      >
        {children}
      </RSelect.Root>
      {name ? (
        <input type="hidden" name={name} value={current} />
      ) : null}
    </>
  );
}

export interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof RSelect.Trigger> {
  /** Display size — `'sm'` matches the dense table-cell selects. */
  size?: 'sm' | 'md';
}

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof RSelect.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ className, size = 'md', children, ...props }, ref) {
  return (
    <RSelect.Trigger
      ref={ref}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md border',
        'border-input bg-background text-sm',
        'placeholder:text-muted-foreground',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&>span]:line-clamp-1 [&>span]:text-left',
        size === 'sm' ? 'px-2 py-1.5' : 'px-3 py-2',
        className,
      )}
      {...props}
    >
      {children}
      <RSelect.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground/70" />
      </RSelect.Icon>
    </RSelect.Trigger>
  );
});

export const SelectValue = RSelect.Value;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof RSelect.Content>,
  React.ComponentPropsWithoutRef<typeof RSelect.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <RSelect.Portal>
      <RSelect.Content
        ref={ref}
        position={position}
        sideOffset={4}
        className={cn(
          'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
          // Match the trigger width when using popper positioning.
          position === 'popper'
            && 'w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <RSelect.ScrollUpButton className="flex h-6 cursor-default items-center justify-center bg-popover">
          <ChevronUp className="size-4" />
        </RSelect.ScrollUpButton>
        <RSelect.Viewport
          className={cn(
            'p-1',
            position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </RSelect.Viewport>
        <RSelect.ScrollDownButton className="flex h-6 cursor-default items-center justify-center bg-popover">
          <ChevronDown className="size-4" />
        </RSelect.ScrollDownButton>
      </RSelect.Content>
    </RSelect.Portal>
  );
});

export interface SelectItemProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RSelect.Item>, 'value'> {
  value: string;
}

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof RSelect.Item>,
  SelectItemProps
>(function SelectItem({ className, children, value, ...props }, ref) {
  // Empty-string values are remapped (see file header) so callers don't have
  // to know about the sentinel.
  const radixValue = value === '' ? EMPTY_VALUE : value;
  return (
    <RSelect.Item
      ref={ref}
      value={radixValue}
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <RSelect.ItemText>{children}</RSelect.ItemText>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <RSelect.ItemIndicator>
          <Check className="size-3.5 text-primary" />
        </RSelect.ItemIndicator>
      </span>
    </RSelect.Item>
  );
});

export const SelectGroup = RSelect.Group;
export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof RSelect.Label>,
  React.ComponentPropsWithoutRef<typeof RSelect.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <RSelect.Label
      ref={ref}
      className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
});

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof RSelect.Separator>,
  React.ComponentPropsWithoutRef<typeof RSelect.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <RSelect.Separator
      ref={ref}
      className={cn('-mx-1 my-1 h-px bg-muted', className)}
      {...props}
    />
  );
});

/* ─── one-liner shortcut ─── */

export type SimpleSelectOption =
  | { value: string; label: React.ReactNode; disabled?: boolean }
  | { type: 'separator' }
  | { type: 'label'; label: React.ReactNode };

export interface SimpleSelectProps {
  options: SimpleSelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Submits as a hidden form input when set. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Class for the trigger. Width defaults to `w-full`. */
  className?: string;
  /** Class for the popover content. */
  contentClassName?: string;
  size?: 'sm' | 'md';
  id?: string;
  /** Forwarded to the trigger for accessibility. */
  ariaLabel?: string;
}

/**
 * The 90% case: pass `options` + value props, get a styled dropdown that's
 * a drop-in replacement for `<select>`.
 */
export function SimpleSelect({
  options, value, defaultValue, onValueChange,
  name, required, disabled, placeholder, className, contentClassName,
  size = 'md', id, ariaLabel,
}: SimpleSelectProps) {
  return (
    <Select
      name={name}
      required={required}
      disabled={disabled}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
    >
      <SelectTrigger
        size={size}
        id={id}
        className={className}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((o, i) => {
          if ('type' in o && o.type === 'separator') {
            // eslint-disable-next-line react/no-array-index-key
            return <SelectSeparator key={`sep-${i}`} />;
          }
          if ('type' in o && o.type === 'label') {
            // eslint-disable-next-line react/no-array-index-key
            return <SelectLabel key={`lbl-${i}`}>{o.label}</SelectLabel>;
          }
          return (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
