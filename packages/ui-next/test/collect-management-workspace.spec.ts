import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCollectManagementCapability } from '../collect-capabilities.ts';

const PRIV_EDIT_SYSTEM = 1;
const PERM_CREATE_COLLECT = 2n;
const PERM_MANAGE_COLLECT = 4n;

function capability(
  user: any,
  onError: (error: unknown) => void = (error) => {
    throw error;
  },
) {
  return resolveCollectManagementCapability({
    user,
    editSystemPriv: PRIV_EDIT_SYSTEM,
    createCollectPerm: PERM_CREATE_COLLECT,
    manageCollectPerm: PERM_MANAGE_COLLECT,
    onError,
  });
}

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

describe('collect management capability', () => {
  it('allows system editors, domain collect managers, and domain collect creators', () => {
    expect(capability({ hasPriv: () => true, hasPerm: () => false })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: (perm: bigint) => perm === PERM_MANAGE_COLLECT })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: (perm: bigint) => perm === PERM_CREATE_COLLECT })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: () => false })).to.equal(false);
  });

  it('fails closed and reports missing or failing permission checks', () => {
    expect(capability(undefined)).to.equal(false);
    const observed: unknown[] = [];
    expect(capability({ hasPriv: () => false }, (error) => observed.push(error))).to.equal(false);
    expect(observed[0]).to.be.instanceOf(TypeError);

    const failure = new Error('permission lookup failed');
    expect(
      capability(
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

    const permissionFailure = new Error('domain permission lookup failed');
    expect(
      capability(
        {
          hasPriv: () => false,
          hasPerm: () => {
            throw permissionFailure;
          },
        },
        (error) => observed.push(error),
      ),
    ).to.equal(false);
    expect(observed[2]).to.equal(permissionFailure);
  });
});

describe('collect management workspace contracts', () => {
  const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
  const bootstrapServer = source('packages/ui-next/index.ts');
  const bootstrapTypes = source('packages/ui-next/src/lib/bootstrap.tsx');
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');

  it('exposes one capability-gated management entry while preserving the public collect entry', () => {
    expect(sidebar).to.match(
      /label: '任务'[\s\S]*?href: '\/tasks'[\s\S]*?label: '文件收集'[\s\S]*?href: '\/collect'[\s\S]*?'collect_main\.html', 'collect_detail\.html'[\s\S]*?label: '协作'/,
    );
    expect(sidebar).to.include('bs.user.canManageCollect');
    expect(sidebar).to.match(/label: '文件收集'[\s\S]*?href: '\/admin\/collect'/);
    for (const template of ['admin_collect.html', 'admin_collect_edit.html', 'admin_collect_stats.html']) {
      expect(sidebar, `sidebar collect management entry missing ${template}`).to.include(template);
    }
  });

  it('publishes an observable server-computed collect capability without replacing route authorization', () => {
    expect(bootstrapServer).to.include('resolveCollectManagementCapability');
    expect(bootstrapServer).to.include('editSystemPriv: PRIV.PRIV_EDIT_SYSTEM');
    expect(bootstrapServer).to.include('createCollectPerm: PERM.PERM_CREATE_COLLECT');
    expect(bootstrapServer).to.include('manageCollectPerm: PERM.PERM_MANAGE_COLLECT');
    expect(bootstrapServer).to.include("'[ui-next] collect management capability resolution failed:'");
    expect(bootstrapServer).to.include('canManageCollect,');
    expect(bootstrapTypes).to.include('canManageCollect?: boolean');
  });

  it('registers collect pages in PAGE_MAP', () => {
    expect(resolver).to.include("from '@/pages/collect'");
    expect(resolver).to.include("from '@/pages/admin-collect'");
    expect(resolver).to.include("'collect_main.html': CollectListPage");
    expect(resolver).to.include("'collect_detail.html': CollectDetailPage");
    expect(resolver).to.include("'admin_collect.html': AdminCollectListPage");
    expect(resolver).to.include("'admin_collect_edit.html': AdminCollectEditPage");
    expect(resolver).to.include("'admin_collect_stats.html': AdminCollectStatsPage");
  });
});
