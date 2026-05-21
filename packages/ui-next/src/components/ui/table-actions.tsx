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
import { type ComponentType, type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

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
    'inline-flex h-7 items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors',
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
      <form
        method="post"
        action={formAction}
        className="inline-block"
        onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
      >
        {hidden && Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button type="submit" className={base} title={hint} disabled={disabled}>
          {inner}
        </button>
      </form>
    );
  }

  return (
    <button type="button" onClick={onClick} className={base} title={hint} disabled={disabled}>
      {inner}
    </button>
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
