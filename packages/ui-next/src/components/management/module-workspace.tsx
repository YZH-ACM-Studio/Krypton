import { type ReactNode, useId } from 'react';
import { AdminPage, type AdminPageProps } from '@/components/admin/admin-page';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

export interface ModuleWorkspaceNavItem {
  key: string;
  label: ReactNode;
  href: string;
  templateNames?: readonly string[];
}

export interface ModuleWorkspaceProps {
  moduleTitle: string;
  title: ReactNode;
  description?: ReactNode;
  navItems: readonly ModuleWorkspaceNavItem[];
  /** Explicitly selects a segment; otherwise the current template resolves it. */
  activeKey?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  toolbarLabel?: string;
  requiredPriv?: AdminPageProps['requiredPriv'];
  /** For modules whose server route and bootstrap capability perform the gate. */
  bypassPrivGate?: boolean;
  contentClassName?: string;
  navAriaLabel?: string;
  children: ReactNode;
}

function resolveModuleWorkspaceActiveKey(items: readonly ModuleWorkspaceNavItem[], templateName: string, activeKey?: string): string {
  if (activeKey !== undefined) {
    if (!items.some((item) => item.key === activeKey)) {
      throw new Error(`Unknown module workspace active key: ${activeKey}`);
    }
    return activeKey;
  }
  const matchedItem = items.find((item) => item.templateNames?.includes(templateName));
  if (!matchedItem) {
    throw new Error(`No module workspace navigation item matches template: ${templateName}`);
  }
  return matchedItem.key;
}

export function ModuleWorkspace({
  moduleTitle,
  title,
  description,
  navItems,
  activeKey,
  actions,
  toolbar,
  toolbarLabel = '页面工具',
  requiredPriv,
  bypassPrivGate = false,
  contentClassName,
  navAriaLabel = `${moduleTitle}导航`,
  children,
}: ModuleWorkspaceProps) {
  const titleId = useId();
  const templateName = useBootstrap().page.templateName;
  const resolvedActiveKey = resolveModuleWorkspaceActiveKey(navItems, templateName, activeKey);

  return (
    <AdminPage requiredPriv={requiredPriv} bypassPrivGate={bypassPrivGate} hideSidebar contentClassName="min-w-0">
      <section aria-labelledby={titleId} className="min-w-0 max-w-full space-y-5 overflow-x-clip">
        <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">{moduleTitle}</p>
            <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-balance">
              {title}
            </h1>
            {description ? <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>

        <nav aria-label={navAriaLabel} className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="inline-flex min-w-max items-center gap-1 rounded-xl bg-muted/70 p-1">
            {navItems.map((item) => {
              const active = item.key === resolvedActiveKey;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium',
                    'transition-[color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    active
                      ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                >
                  {item.label}
                </a>
              );
            })}
          </div>
        </nav>

        {toolbar ? (
          <section aria-label={toolbarLabel} className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 border-y border-border/70 py-2">
            {toolbar}
          </section>
        ) : null}

        <div className={cn('min-w-0 space-y-5', contentClassName)}>{children}</div>
      </section>
    </AdminPage>
  );
}
