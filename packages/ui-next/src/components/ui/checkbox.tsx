/**
 * Native checkbox. The input stays submittable and is the `peer` for the
 * check stroke, so the dash animation follows `:checked` even when React
 * does not know the uncontrolled state. The box is a later sibling painted
 * under the icon: `isolate` keeps `-z-10` inside this control.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md';
  indeterminate?: boolean;
  /** Called with the new boolean state, before the standard onChange. */
  onCheckedChange?: (checked: boolean) => void;
  /** When set, the control and copy are wrapped in a label so the text toggles it. */
  label?: ReactNode;
  /** Secondary line under `label`. Ignored when `label` is omitted. */
  description?: ReactNode;
}

function assignInputRef(ref: Ref<HTMLInputElement> | null, node: HTMLInputElement | null) {
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  if (ref) {
    (ref as MutableRefObject<HTMLInputElement | null>).current = node;
  }
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({
  className,
  size = 'md',
  indeterminate = false,
  onCheckedChange,
  onChange,
  disabled,
  label,
  description,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}, forwardedRef) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const forwardedRefRef = useRef(forwardedRef);
  const indeterminateRef = useRef(indeterminate);
  const checkedPropRef = useRef(props.checked);
  const checkedRef = useRef<boolean | null>(null);
  indeterminateRef.current = indeterminate;
  checkedPropRef.current = props.checked;
  const labelId = useId();
  const descriptionId = useId();
  const box = size === 'sm' ? 'size-3.5' : 'size-4';
  const icon = size === 'sm' ? 'size-2.5' : 'size-3';

  // The callback passed to <input> stays stable so React 19 does not detach it
  // every render. When the forwarded ref identity changes, publish the current
  // node to the new ref and clear the previous one.
  useLayoutEffect(() => {
    const previous = forwardedRefRef.current;
    if (previous === forwardedRef) {
      return;
    }
    assignInputRef(previous, null);
    forwardedRefRef.current = forwardedRef;
    assignInputRef(forwardedRef, inputRef.current);
  }, [forwardedRef]);

  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    const previous = inputRef.current;
    if (node === null && previous) {
      checkedRef.current = previous.checked;
    }
    // Adding `label` changes the root from span to label and remounts the input.
    // Copy the uncontrolled checked state onto the new node; defaultChecked alone
    // would drop a toggle the user already made.
    if (
      node
      && node !== previous
      && checkedPropRef.current === undefined
      && checkedRef.current !== null
    ) {
      node.checked = checkedRef.current;
    }
    if (node) {
      node.indeterminate = indeterminateRef.current;
    }
    inputRef.current = node;
    assignInputRef(forwardedRefRef.current, node);
  }, []);

  // React has no indeterminate attribute. A click clears it without a prop change,
  // and a checked/defaultChecked update can clear it too. Remounts are handled in setInputRef.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate, props.checked, props.defaultChecked]);

  const control = (
    <span
      className={cn(
        'relative isolate inline-flex shrink-0 items-center justify-center align-middle',
        box,
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        !label && disabled && 'opacity-45',
        className,
      )}
    >
      <input
        ref={setInputRef}
        disabled={disabled}
        onChange={(event) => {
          const node = event.currentTarget;
          checkedRef.current = node.checked;
          node.indeterminate = indeterminateRef.current;
          onCheckedChange?.(node.checked);
          onChange?.(event);
        }}
        {...props}
        type="checkbox"
        className="peer absolute inset-0 m-0 size-full cursor-inherit opacity-0"
        aria-labelledby={label ? ariaLabelledBy ?? labelId : ariaLabelledBy}
        aria-describedby={label && description ? ariaDescribedBy ?? descriptionId : ariaDescribedBy}
      />
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className={cn(
          'pointer-events-none',
          icon,
          indeterminate
            ? 'text-on-brand'
            : 'text-transparent peer-checked:text-on-brand [stroke-dashoffset:1] peer-checked:[stroke-dashoffset:0] transition-[stroke-dashoffset] duration-(--dur-2) ease-(--ease-out)',
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {indeterminate ? (
          <path d="M4 8h8" />
        ) : (
          <path
            d="M3.5 8.5l3 3 6-7"
            pathLength={1}
            strokeDasharray={1}
          />
        )}
      </svg>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 -z-10 rounded-sm border bg-surface shadow-xs transition-colors duration-(--dur-1) ease-(--ease-standard)',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
          indeterminate
            ? 'border-brand bg-brand'
            : 'border-line-strong peer-checked:border-brand peer-checked:bg-brand',
        )}
      />
    </span>
  );

  if (!label) {
    return control;
  }

  return (
    <label
      className={cn(
        'inline-flex items-start gap-2.5',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
      )}
    >
      {control}
      <span className="flex flex-col">
        <span id={labelId} className="text-sm text-fg">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="text-xs text-fg-subtle">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
});
