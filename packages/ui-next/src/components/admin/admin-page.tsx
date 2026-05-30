import { type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { canAccessDomainAdmin, hasAnyPriv, type PrivBit } from '@/lib/perms';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface AdminPageProps {
  /** Page heading content (string or node). Rendered above children. */
  title?: ReactNode;
  /** Right-aligned actions next to the title. */
  actions?: ReactNode;
  /** Optional description under the title. */
  description?: ReactNode;
  /** Required priv bits (any-of). Falls back to general admin gate if omitted. */
  requiredPriv?: PrivBit | PrivBit[];
  /** Bypass the priv gate entirely (used by self-service style admin pages — rare). */
  bypassPrivGate?: boolean;
  /** Hide the secondary sidebar; useful for full-bleed pages. */
  hideSidebar?: boolean;
  /** Override the wrapping container width. */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Container component used by every page rendered under `/admin/*` (in routing terms,
 * those whose hydrooj template name we map into PAGE_MAP). Provides:
 *
 * - the priv gate (renders ForbiddenPanel on denial)
 * - the secondary `AdminSidebar` (per-section nav registered via admin-nav-registry)
 * - consistent header (title, description, actions)
 */
export function AdminPage({
  title,
  actions,
  description,
  requiredPriv,
  bypassPrivGate = false,
  hideSidebar = false,
  contentClassName,
  children,
}: AdminPageProps) {
  const bs = useBootstrap();
  const userPriv = bs.user.priv ?? 0;

  if (!bypassPrivGate) {
    if (!bs.user.signedIn) {
      return <ForbiddenPanel message="请先登录后再访问该页面。" />;
    }

    let allowed = false;
    if (requiredPriv) {
      const bits = Array.isArray(requiredPriv) ? requiredPriv : [requiredPriv];
      allowed = hasAnyPriv(userPriv, ...bits);
    } else {
      allowed = canAccessDomainAdmin(userPriv);
    }
    if (!allowed) return <ForbiddenPanel />;
  }

  // Layout note (round-10 split scroll):
  // The outer admin frame is pinned to viewport height minus the top bar
  // (h-12 = 48px) and main's own vertical padding (24-32px depending on
  // breakpoint). Both panes are flex children with min-h-0 + their own
  // overflow-y-auto, so they scroll independently — the sidebar never
  // drifts when the right column scrolls a long page, and a long sidebar
  // doesn't push the content area down.
  return (
    <div
      className={cn(
        'flex w-full items-stretch gap-6 min-h-0',
        // 6rem = topbar (3rem) + main top padding (1.5rem) + main bottom padding (1.5rem).
        // sm/xl variants match main's responsive padding in router.tsx.
        'h-[calc(100dvh-6rem)] sm:h-[calc(100dvh-6rem)] xl:h-[calc(100dvh-7rem)]',
      )}
    >
      {!hideSidebar ? <AdminSidebar currentTemplate={bs.page.templateName} /> : null}

      <ScrollArea className="min-w-0 min-h-0 flex-1" viewportClassName="pr-1">
        <motion.div
          className={cn('space-y-5', contentClassName)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
        >
          {(title || actions || description) && (
            <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                {title ? (
                  typeof title === 'string' ? (
                    <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                  ) : (
                    title
                  )
                ) : null}
                {description ? (
                  typeof description === 'string' ? (
                    <p className="text-sm text-muted-foreground">{description}</p>
                  ) : (
                    description
                  )
                ) : null}
              </div>
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </header>
          )}

          {children}
        </motion.div>
      </ScrollArea>
    </div>
  );
}
