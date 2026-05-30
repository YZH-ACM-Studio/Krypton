/**
 * `<TableActions>` — uniform action group rendered in a table's last column.
 *
 * The old pattern was a row of ghost `<Button>`s right-aligned via
 * `text-right` + `justify-end`. Visually the header label ended up flush
 * right while the buttons huddled at the right edge — not actually aligned.
 *
 * The new pattern:
 *   - actions left-align inside the cell (so the column reads naturally
 *     left-to-right and the header label sits directly above the first
 *     button)
 *   - every action is a real outline button with a uniform `h-7 px-2.5
 *     text-xs` size — icon-only actions still get the same hit area
 *   - destructive actions render with a red border + text-destructive
 *
 *   <TableActions>
 *     <TableAction href={`/admin/tasks/${id}/stats`}>统计</TableAction>
 *     <TableAction href={`/admin/tasks/${id}/edit`}  icon={Pencil}>编辑</TableAction>
 *     <TableAction onSubmit={...} icon={Copy} hint="复制" formAction="..." />
 *     <TableAction onSubmit={...} icon={Trash2} variant="destructive"
 *                  formAction="..." confirm="确定删除？" />
 *   </TableActions>
 *
 * If a `formAction` is set, the action renders as a `<form>` so it can
 * POST to a hydrooj handler (no JS required).
 */
import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

export function TableAction({
  children, href, formAction, confirm, hidden, hint, icon: Icon,
  variant = 'default', disabled, className, onClick,
}: TableActionProps) {
  const isIconOnly = !children;
  const base = cn(
    // whitespace-nowrap stops cramped action columns from word-wrapping Chinese
    // characters one-per-line ("置/顶" rendered as a vertical column).
    'inline-flex h-7 items-center justify-center gap-1 rounded-md border text-xs font-medium whitespace-nowrap transition-colors',
    isIconOnly ? 'w-7 px-0' : 'px-2.5',
    variant === 'destructive'
      ? 'border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive/10'
      : variant === 'primary'
      ? 'border-primary/50 text-primary hover:border-primary hover:bg-primary/10'
      : 'border-border bg-background text-foreground shadow-sm hover:border-foreground/30 hover:bg-muted',
    disabled && 'pointer-events-none opacity-50',
    className,
  );

  const inner = (
    <>
      {Icon && <Icon className={cn(isIconOnly ? 'size-3.5' : 'size-3')} />}
      {children}
    </>
  );

  if (href) {
    return (
      <a href={href} className={base} title={hint || (isIconOnly ? undefined : undefined)}>
        {inner}
      </a>
    );
  }

  if (formAction) {
    return (
      <TableActionForm
        formAction={formAction}
        confirm={confirm}
        hidden={hidden}
        base={base}
        hint={hint}
        disabled={disabled}
        variant={variant}
        label={typeof children === 'string' ? children : undefined}
      >
        {inner}
      </TableActionForm>
    );
  }

  return (
    <button type="button" onClick={onClick} className={base} title={hint} disabled={disabled}>
      {inner}
    </button>
  );
}

/**
 * Internal: renders a `<form>` action with an in-page Dialog instead of
 * `window.confirm` for destructive confirmation.
 */
function TableActionForm({
  formAction, confirm, hidden, base, hint, disabled, variant, label, children,
}: {
  formAction: string;
  confirm?: string;
  hidden?: Record<string, string | number>;
  base: string;
  hint?: string;
  disabled?: boolean;
  variant: TableActionVariant;
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
        action={formAction}
        className="inline-block"
        onSubmit={(e) => {
          if (confirm && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {hidden && Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button type="submit" className={base} title={hint} disabled={disabled}>
          {children}
        </button>
      </form>
      {confirm ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="w-full sm:w-[440px]">
            <DialogHeader>
              <DialogTitle>{label ? `${label}确认` : '确认操作'}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{confirm}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                onClick={() => {
                  setOpen(false);
                  // Bypass the confirm path now that the user has agreed.
                  if (formRef.current) {
                    const f = formRef.current;
                    // Manually submit (HTMLFormElement.submit skips submit event)
                    f.submit();
                  }
                }}
              >
                {label || '确认'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function TableActions({
  children, className, align = 'start',
}: {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end' | 'center';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5',
        align === 'end' && 'justify-end',
        align === 'center' && 'justify-center',
        className,
      )}
    >
      {children}
    </div>
  );
}
