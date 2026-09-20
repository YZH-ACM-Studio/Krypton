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

  const body = (
    <motion.div className={cn('min-w-0 space-y-5', contentClassName)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      {(title || actions || description) && (
        <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {title ? typeof title === 'string' ? <h1 className="text-xl font-semibold tracking-tight">{title}</h1> : title : null}
            {description ? typeof description === 'string' ? <p className="text-sm text-muted-foreground">{description}</p> : description : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      )}

      {children}
    </motion.div>
  );

  // Full-bleed modules (ModuleWorkspace, etc.) keep page-level scroll. Pinning
  // them to the split-pane height would nest a viewport inside router padding
  // and clip or double-scroll the content.
  if (hideSidebar) {
    return <div className="w-full min-w-0">{body}</div>;
  }

  // Split scroll: pin to 100dvh minus topbar (h-12 / 3rem) and main padding
  // from router.tsx (`p-3 sm:p-6 xl:p-8`). Same formula as mindmap/admin.
  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 items-stretch gap-6',
        'h-[calc(100dvh-4.5rem)] sm:h-[calc(100dvh-6rem)] xl:h-[calc(100dvh-7rem)]',
      )}
    >
      <AdminSidebar currentTemplate={bs.page.templateName} />
      <ScrollArea className="min-h-0 min-w-0 flex-1" viewportLayout="block" viewportClassName="pr-1 [&>div]:min-w-0 [&>div]:w-full">
        {body}
      </ScrollArea>
    </div>
  );
}
