/**
 * `<TableActions>` — action group for a table's last column.
 *
 * Actions left-align under the header. Each `TableAction` is a ghost `sm`
 * button: destructive uses danger text, primary uses brand text. A
 * `formAction` renders a real `<form method="post">` so it works without JS.
 * `formAction=""` submits to the current URL; omit the prop for a plain button.
 *
 *   <TableActions>
 *     <TableAction href={`/admin/tasks/${id}/stats`}>统计</TableAction>
 *     <TableAction formAction="/admin/tasks" confirm="确定删除？" variant="destructive">删除</TableAction>
 *   </TableActions>
 */
import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export type TableActionVariant = 'default' | 'destructive' | 'primary';

export interface TableActionProps {
  /** Action label (omit for icon-only buttons; pair with `hint` for title). */
  children?: ReactNode;
  /** When set, renders as `<a href>`. */
  href?: string;
  /** When set, renders as a `<form method=post action=...>`. */
  formAction?: string;
  /** Confirmation prompt before submitting the form. */
  confirm?: string;
  /** Hidden inputs to include in the form (POST body). */
  hidden?: Record<string, string | number>;
  /** Tooltip for icon-only actions. */
  hint?: string;
  /** Optional left icon. */
  icon?: LucideIcon | ComponentType<{ className?: string }>;
  /** Visual style. */
  variant?: TableActionVariant;
  /** Disable the action. */
  disabled?: boolean;
  /** Override the rendered class (rarely needed). */
  className?: string;
  /** Direct click handler (only used when neither `href` nor `formAction` set). */
  onClick?: () => void;
}

function toneClass(variant: TableActionVariant): string | undefined {
  // Ghost hover:text-fg outranks a plain tone color, so the hover color has to win too.
  if (variant === 'destructive') {
    return 'text-danger-fg hover:text-danger-fg!';
  }
  if (variant === 'primary') {
    return 'text-brand-fg hover:text-brand-fg!';
  }
  return undefined;
}

export function TableAction({
  children,
  href,
  formAction,
  confirm,
  hidden,
  hint,
  icon: Icon,
  variant = 'default',
  disabled,
  className,
  onClick,
}: TableActionProps) {
  const iconOnly = !children;
  const actionClass = cn('whitespace-nowrap', toneClass(variant), disabled && 'pointer-events-none opacity-45', className);
  const inner = (
    <>
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </>
  );

  if (href) {
    return (
      <Button asChild variant="ghost" size="sm" iconOnly={iconOnly} className={actionClass}>
        <a
          href={href}
          title={hint}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : undefined}
          onClick={disabled ? (event) => event.preventDefault() : undefined}
        >
          {inner}
        </a>
      </Button>
    );
  }

  // `!== undefined` is required: `formAction=""` is a real submit-to-current-URL.
  // A truthy check dropped those buttons into the no-op `type="button"` branch.
  if (formAction !== undefined) {
    return (
      <TableActionForm
        formAction={formAction}
        confirm={confirm}
        hidden={hidden}
        actionClass={actionClass}
        hint={hint}
        disabled={disabled}
        variant={variant}
        iconOnly={iconOnly}
        label={typeof children === 'string' ? children : undefined}
      >
        {inner}
      </TableActionForm>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly={iconOnly}
      onClick={onClick}
      className={actionClass}
      title={hint}
      disabled={disabled}
    >
      {inner}
    </Button>
  );
}

/**
 * Renders a `<form>` action. Confirmation uses an in-page Dialog;
 * agreeing calls `HTMLFormElement.submit()`, which skips the submit event.
 */
function TableActionForm({
  formAction,
  confirm,
  hidden,
  actionClass,
  hint,
  disabled,
  variant,
  iconOnly,
  label,
  children,
}: {
  formAction: string;
  confirm?: string;
  hidden?: Record<string, string | number>;
  actionClass: string;
  hint?: string;
  disabled?: boolean;
  variant: TableActionVariant;
  iconOnly: boolean;
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  return (
    <>
      <form
        ref={formRef}
        method="post"
        // An empty string is omitted so React 19 does not special-case action="".
        action={formAction || undefined}
        className="inline-block"
        onSubmit={(event) => {
          if (confirm && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {hidden ? Object.entries(hidden).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />) : null}
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          iconOnly={iconOnly}
          className={actionClass}
          title={hint}
          disabled={disabled}
        >
          {children}
        </Button>
      </form>
      {confirm ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{label ? `${label}确认` : '确认操作'}</DialogTitle>
              <DialogDescription>{confirm}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                onClick={() => {
                  setOpen(false);
                  if (formRef.current) {
                    formRef.current.submit();
                  }
                }}
              >
                {label || '确认'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function TableActions({
  children,
  className,
  align = 'start',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end' | 'center';
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', align === 'end' && 'justify-end', align === 'center' && 'justify-center', className)}>
      {children}
    </div>
  );
}
