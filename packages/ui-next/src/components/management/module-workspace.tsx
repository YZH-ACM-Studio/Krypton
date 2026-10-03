import { type ReactNode, useId } from 'react';
import { AdminPage, type AdminPageProps } from '@/components/admin/admin-page';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Toolbar } from '@/components/ui/page';
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
  /** Hide the module pill nav (create/edit pages that already have a back link). */
  hideNav?: boolean;
  children: ReactNode;
}

const railItemClass = [
  'flex h-8 w-full items-center rounded-md px-2 text-sm outline-none',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  'transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)',
].join(' ');

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

function moduleRailLink(item: ModuleWorkspaceNavItem, activeKey: string) {
  const active = item.key === activeKey;
  return (
    <a
      key={item.key}
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        railItemClass,
        active
          ? 'bg-surface-active font-medium text-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {item.label}
    </a>
  );
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
  hideNav = false,
  children,
}: ModuleWorkspaceProps) {
  const titleId = useId();
  const templateName = useBootstrap().page.templateName;
  const resolvedActiveKey = hideNav ? '' : resolveModuleWorkspaceActiveKey(navItems, templateName, activeKey);
  const toolbarSection = toolbar ? (
    <section aria-label={toolbarLabel}>
      <Toolbar className="min-h-11 border-y border-line py-2">{toolbar}</Toolbar>
    </section>
  ) : null;
  const mainContent = <div className={cn('min-w-0 space-y-5', contentClassName)}>{children}</div>;

  return (
    <AdminPage requiredPriv={requiredPriv} bypassPrivGate={bypassPrivGate} hideSidebar contentClassName="min-w-0">
      <section aria-labelledby={titleId} className="min-w-0 max-w-full space-y-5">
        <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium tracking-wide text-fg-subtle">{moduleTitle}</p>
            <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-balance text-fg">
              {title}
            </h1>
            {description ? <p className="max-w-prose text-sm leading-6 text-fg-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>

        {hideNav ? (
          <>
            {toolbarSection}
            {mainContent}
          </>
        ) : (
          <>
            <nav aria-label={navAriaLabel} className="max-w-full lg:hidden">
              <MiniTabs
                aria-label={navAriaLabel}
                value={resolvedActiveKey}
                items={navItems.map((item) => ({
                  value: item.key,
                  label: item.label,
                  href: item.href,
                }))}
              />
            </nav>
            <div className="flex min-w-0 flex-col gap-5 lg:flex-row">
              <aside className="hidden w-60 shrink-0 lg:block">
                <nav aria-label={navAriaLabel} className="sticky top-0 flex flex-col gap-0.5">
                  {navItems.map((item) => moduleRailLink(item, resolvedActiveKey))}
                </nav>
              </aside>
              <div className="min-w-0 flex-1 space-y-5">
                {toolbarSection}
                {mainContent}
              </div>
            </div>
          </>
        )}
      </section>
    </AdminPage>
  );
}
