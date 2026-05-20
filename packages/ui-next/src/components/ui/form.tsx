/**
 * Form primitives — semantic wrappers that bake in spacing so every form
 * in the app looks consistent. Replace ad-hoc `<div className="space-y-1">`
 * + `<label>` + `<Input>` triples with these.
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
 *    <FormField label="备注" hint="可选">
 *      <textarea ... />
 *    </FormField>
 *  </FormSection>
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function FormSection({
  title, description, children, className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-4', className)}>
      {(title || description) && (
        <header className="space-y-1">
          {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </header>
      )}
      <div className="space-y-4">
        {children}
      </div>
    </section>
  );
}

export function FormRow({
  columns = 1, children, className,
}: {
  /** Number of columns at md+ breakpoint. */
  columns?: 1 | 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  const cols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  }[columns];
  return (
    <div className={cn('grid gap-4', cols, className)}>
      {children}
    </div>
  );
}

export function FormField({
  label, htmlFor, required, hint, error, children, className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1 text-sm font-medium text-foreground"
        >
          <span>{label}</span>
          {required && <span className="text-destructive">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Padded card body — replaces `<CardContent className="p-0">`'s `p-0` antipattern. */
export function CardBody({
  children, className, dense,
}: { children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <div className={cn(dense ? 'p-4' : 'p-5 sm:p-6', className)}>
      {children}
    </div>
  );
}
