import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAnnouncementManagementCapability } from '../announcement-capabilities.ts';

const PRIV_EDIT_SYSTEM = 1;
const PERM_EDIT_DOMAIN = 2n;

function resolve(
  user: any,
  onError: (error: unknown) => void = (error) => {
    throw error;
  },
) {
  return resolveAnnouncementManagementCapability({
    user,
    editSystemPriv: PRIV_EDIT_SYSTEM,
    editDomainPerm: PERM_EDIT_DOMAIN,
    onError,
  });
}

const workspaceRoot = resolvePath(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolvePath(workspaceRoot, path), 'utf8');
}

describe('announcement management capability', () => {
  it('allows either the system privilege or the current-domain edit permission', () => {
    expect(resolve({ hasPriv: () => true, hasPerm: () => false })).to.equal(true);
    expect(resolve({ hasPriv: () => false, hasPerm: (perm: bigint) => perm === PERM_EDIT_DOMAIN })).to.equal(true);
    expect(resolve({ hasPriv: () => false, hasPerm: () => false })).to.equal(false);
  });

  it('fails closed and reports permission resolution errors', () => {
    expect(resolve(undefined)).to.equal(false);
    const observed: unknown[] = [];
    expect(resolve({ hasPriv: () => false }, (error) => observed.push(error))).to.equal(false);
    expect(observed[0]).to.be.instanceOf(TypeError);

    const failure = new Error('permission lookup failed');
    expect(
      resolve(
        {
          hasPriv: () => {
            throw failure;
          },
          hasPerm: () => true,
        },
        (error) => observed.push(error),
      ),
    ).to.equal(false);
    expect(observed[1]).to.equal(failure);
  });
});

describe('main management navigation contracts', () => {
  const stats = source('packages/ui-next/src/pages/admin-stats.tsx');
  const announcement = source('packages/ui-next/src/pages/announcement/index.tsx');
  const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
  const bootstrapServer = source('packages/ui-next/index.ts');
  const bootstrapTypes = source('packages/ui-next/src/lib/bootstrap.tsx');
  const handler = source('packages/krypton-announcement/src/handler.ts');

  it('keeps statistics only in the main sidebar and renders it full width', () => {
    expect(stats).not.to.include('registerAdminNavSection');
    expect(stats).to.match(/<AdminPage[\s\S]*?hideSidebar/);
    expect(sidebar.match(/label: '统计中心'/g) || []).to.have.lengthOf(1);
  });

  it('uses one capability-gated announcement entry for every admin template', () => {
    expect(sidebar.match(/label: '公告管理'/g) || []).to.have.lengthOf(1);
    expect(sidebar).to.include('bs.user.canManageAnnouncements');
    for (const template of ['admin_announce_list.html', 'admin_announce_edit.html', 'admin_announce_categories.html']) {
      expect(sidebar).to.include(template);
    }
  });

  it('publishes the server-computed capability and keeps route authorization canonical', () => {
    expect(bootstrapServer).to.include('resolveAnnouncementManagementCapability');
    expect(bootstrapServer).to.include('editSystemPriv: PRIV.PRIV_EDIT_SYSTEM');
    expect(bootstrapServer).to.include('editDomainPerm: PERM.PERM_EDIT_DOMAIN');
    expect(bootstrapServer).to.include("'[ui-next] announcement management capability resolution failed:'");
    expect(bootstrapServer).to.include('canManageAnnouncements,');
    expect(bootstrapTypes).to.include('canManageAnnouncements?: boolean');

    expect(handler).to.include('this.user.hasPerm(PERM.PERM_EDIT_DOMAIN)');
    expect(handler).to.include('this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
    for (const route of [
      "ctx.Route('admin_announce', '/admin/announce', AdminAnnounceListHandler)",
      "ctx.Route('admin_announce_create', '/admin/announce/new', AdminAnnounceCreateHandler)",
      "ctx.Route('admin_announce_edit', '/admin/announce/:aid/edit', AdminAnnounceEditHandler)",
      "ctx.Route('admin_announce_categories', '/admin/announce/categories', AdminCategoriesHandler)",
    ]) {
      expect(handler).to.include(route);
    }
  });

  it('uses the shared management workspace without legacy admin navigation', () => {
    expect(announcement).not.to.include('registerAdminNavSection');
    expect(announcement.match(/<ModuleWorkspace\b/g) || []).to.have.lengthOf(3);
    expect(announcement).to.include("label: '公告'");
    expect(announcement).to.include("label: '分类'");
    expect(announcement).to.include('activeKey="announcements"');
    expect(announcement).to.include('activeKey="categories"');
  });

  it('preserves all existing announcement write operations and editor fields', () => {
    for (const operation of ["'reorder'", "'create'", "'update'", "'delete'", '"upsert"']) {
      expect(announcement).to.include(operation);
    }
    for (const field of ['title', 'content', 'category', 'scope', 'publishAt', 'unpublishAt', 'pin', 'hidden']) {
      expect(announcement).to.match(new RegExp(`name=["']${field}["']`));
    }
  });

  it('keeps announcement management controls at least forty pixels tall', () => {
    const adminWorkspace = announcement.slice(announcement.indexOf('interface AdminListBody'));
    expect(adminWorkspace.match(/<TableAction\b/g) || []).to.have.lengthOf(5);
    expect(adminWorkspace.match(/contentClassName="\[&_\[role=option\]\]:min-h-10"/g) || []).to.have.lengthOf(3);
    expect(adminWorkspace.match(/min-h-10/g) || []).to.have.lengthOf(29);
  });
});

describe('dialog scrolling contracts', () => {
  const dialog = source('packages/ui-next/src/components/ui/dialog.tsx');
  const tokens = source('packages/ui-next/src/pages/authtoken/index.tsx');
  const accounts = source('packages/ui-next/src/pages/admin-accounts.tsx');

  it('provides one shared, bounded native-scroll body', () => {
    expect(dialog).to.include('export function DialogBody');
    expect(dialog).to.include('min-h-0 flex-1 overflow-y-auto overscroll-contain');
  });

  it('keeps both long create forms between fixed headers and action bars', () => {
    expect(tokens).to.match(/function IssueDialog[\s\S]*?<DialogBody[\s\S]*?<\/DialogBody>[\s\S]*?border-t/);
    expect(accounts).to.match(/function CreateAccountDialog[\s\S]*?<DialogBody[\s\S]*?<\/DialogBody>[\s\S]*?border-t/);
  });
});
