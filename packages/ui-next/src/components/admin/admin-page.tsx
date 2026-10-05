import { type ReactNode } from 'react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { canAccessDomainAdmin, hasAnyPriv, type PrivBit } from '@/lib/perms';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { ForbiddenPanel } from '@/components/admin/forbidden';
import { Page, PageHeader, Workspace } from '@/components/ui/page';
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
function AdminHeading({ title, description, actions }: Pick<AdminPageProps, 'title' | 'description' | 'actions'>) {
  if (typeof title === 'string') {
    return <PageHeader title={title} description={description} actions={actions} />;
  }
  if (!title && !description && !actions) {
    return null;
  }
  return (
    <header className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        {title || null}
        {description
          ? typeof description === 'string'
            ? <p className="mt-1.5 max-w-prose text-sm text-pretty text-fg-muted">{description}</p>
            : description
          : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

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

  const heading = <AdminHeading title={title} description={description} actions={actions} />;
  const content = <div className={cn('min-w-0', contentClassName)}>{children}</div>;

  // Full-bleed modules scroll with the shell page. The split shell below owns
  // its height, so those pages must not be pinned inside it.
  if (hideSidebar) {
    return (
      <Page width="wide">
        {heading}
        {content}
      </Page>
    );
  }

  return (
    <Workspace className="w-full min-w-0">
      <div className="flex min-h-0 flex-1">
        <AdminSidebar currentTemplate={bs.page.templateName} />
        <ScrollArea viewportLayout="block" className="min-h-0 min-w-0 flex-1">
          <div className="mx-auto w-full px-4 pt-5 pb-16 sm:px-6 sm:pt-8 lg:px-8">
            <div className="flex flex-col gap-6 short:gap-4">
              {heading}
              {content}
            </div>
          </div>
        </ScrollArea>
      </div>
    </Workspace>
  );
}
