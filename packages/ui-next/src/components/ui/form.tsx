/**
 * Form primitives — semantic wrappers that bake in spacing so every form
 * in the app looks consistent.
 *
 *  <FormSection title="基本信息" description="...">
 *    <FormRow columns={2}>
 *      <FormField label="学号" required>
 *        <Input name="studentId" />
 *      </FormField>
 *      <FormField label="姓名" required>
 *        <Input name="realName" />
 *      </FormField>
 *    </FormRow>
 *    <FormField label="备注" optional hint="选填说明">
 *      <textarea ... />
 *    </FormField>
 *  </FormSection>
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const FORM_ROW_COLUMNS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-4',
} as const;

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-4', className)}>
      {title || description ? (
        <header className="space-y-1">
          {title ? <h3 className="text-sm font-semibold text-fg">{title}</h3> : null}
          {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
        </header>
      ) : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function FormRow({
  columns = 1,
  children,
  className,
}: {
  /** Column count from `sm` up. Below `sm` the row stays a single column. */
  columns?: 1 | 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('grid gap-4 [&>*]:min-w-0', FORM_ROW_COLUMNS[columns], className)}>{children}</div>;
}

export function FormField({
  label,
  htmlFor,
  required,
  optional,
  hint,
  error,
  inline,
  children,
  className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** Label left, control right from `sm`. Hint sits under the label. */
  inline?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(inline ? 'grid gap-1.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-6' : 'flex flex-col gap-1.5', className)}>
      {label ? (
        <div className={cn(inline && 'sm:pt-1.5')}>
          <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
            {label}
            {required ? <span className="ml-0.5 text-danger-fg">*</span> : null}
            {optional ? <span className="ml-1.5 text-xs font-normal text-fg-subtle">可选</span> : null}
          </label>
          {inline && hint && !error ? <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p> : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {error ? (
          <p role="alert" className="text-xs text-danger-fg">
            {error}
          </p>
        ) : hint && (!inline || !label) ? (
          <p className="text-xs text-fg-subtle">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
