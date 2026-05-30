import { useMemo } from 'react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { canSeeAdminAffordance, hasPriv, type PrivBit } from '@/lib/perms';
import { getAdminNavSections } from '@/lib/admin-nav-registry';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

export function AdminSidebar({ currentTemplate }: { currentTemplate: string }) {
  const bs = useBootstrap();
  const priv = bs.user.priv ?? 0;
  const role = bs.user.role;
  const userCtx = { priv, role, signedIn: bs.user.signedIn };

  const sections = useMemo(() => {
    return getAdminNavSections().filter((section) => {
      if (section.requiredPriv && !hasPriv(priv, section.requiredPriv as PrivBit)) return false;
      if (section.requiredAccess && !canSeeAdminAffordance(userCtx, section.requiredAccess)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priv, role, bs.user.signedIn]);

  if (sections.length === 0) {
    return null;
  }

  return (
    <aside className="hidden h-full w-56 shrink-0 min-h-0 lg:block">
      {/* Own scroll area: scrolls independently from the right column. */}
      <ScrollArea className="h-full" viewportClassName="pr-1 pt-2 pb-6">
        <nav className="space-y-5">
        {sections.map((section) => {
          const visibleItems = section.items.filter((item) => {
            if (item.requiredPriv && !hasPriv(priv, item.requiredPriv as PrivBit)) return false;
            if (item.requiredAccess && !canSeeAdminAffordance(userCtx, item.requiredAccess)) return false;
            return true;
          });
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.key} className="space-y-1">
              <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </h3>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const active = item.templateNames?.includes(currentTemplate) ?? false;
                  const Icon = item.icon;
                  return (
                    <li key={item.key}>
                      <a
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-foreground/70 hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {Icon ? <Icon className="size-4 shrink-0" /> : null}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge != null ? (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                            {item.badge}
                          </Badge>
                        ) : null}
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
