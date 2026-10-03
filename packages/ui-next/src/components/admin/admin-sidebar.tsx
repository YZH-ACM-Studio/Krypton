import { useMemo } from 'react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { canSeeAdminAffordance, hasPriv, type PrivBit } from '@/lib/perms';
import { getAdminNavSections } from '@/lib/admin-nav-registry';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

const navItemClass = [
  'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm outline-none',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  'transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-(--dur-1) ease-(--ease-standard)',
  '[&_svg]:size-4 [&_svg]:shrink-0',
].join(' ');

export function AdminSidebar({ currentTemplate }: { currentTemplate: string }) {
  const bs = useBootstrap();
  const priv = bs.user.priv ?? 0;
  const role = bs.user.role;
  const signedIn = bs.user.signedIn;

  const sections = useMemo(() => {
    const userCtx = { priv, role, signedIn };
    return getAdminNavSections().filter((section) => {
      if (section.requiredPriv && !hasPriv(priv, section.requiredPriv as PrivBit)) return false;
      if (section.requiredAccess && !canSeeAdminAffordance(userCtx, section.requiredAccess)) return false;
      return true;
    });
  }, [priv, role, signedIn]);

  if (sections.length === 0) {
    return null;
  }

  return (
    <aside className="hidden h-full min-h-0 w-60 shrink-0 flex-col border-r border-line bg-surface-sunken lg:flex">
      <ScrollArea className="min-h-0 flex-1" viewportLayout="block" viewportClassName="pb-4">
        <nav>
          {sections.map((section) => {
            const visibleItems = section.items.filter((item) => {
              if (item.requiredPriv && !hasPriv(priv, item.requiredPriv as PrivBit)) return false;
              if (item.requiredAccess && !canSeeAdminAffordance({ priv, role, signedIn }, item.requiredAccess)) return false;
              return true;
            });
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.key}>
                <h3 className="px-2 pt-4 pb-1 text-2xs font-semibold text-fg-subtle">{section.label}</h3>
                <ul className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => {
                    const active = item.templateNames?.includes(currentTemplate) ?? false;
                    const Icon = item.icon;
                    return (
                      <li key={item.key}>
                        <a
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            navItemClass,
                            active
                              ? 'bg-surface-active font-medium text-fg [&_svg]:text-fg'
                              : 'text-fg-muted hover:bg-surface-hover hover:text-fg [&_svg]:text-fg-subtle',
                          )}
                        >
                          {Icon ? <Icon className="size-4 shrink-0" /> : null}
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge != null ? <Badge size="sm">{item.badge}</Badge> : null}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
