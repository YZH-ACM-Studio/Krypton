import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { resolveDomainPermissionManagementCapability } from '../domain-permission-capabilities.ts';
import { buildSudoReplayFields, resolveSudoReplayTarget } from '../src/lib/sudo-replay.ts';
import {
  composeDomainPermissionMask,
  diffDomainPermissionDraft,
  filterDomainPermissionFamilies,
  parseDomainRoleMask,
  permissionKeysFromMask,
  type DomainPermissionFamily,
} from '../src/lib/domain-permission-state.ts';

const families: DomainPermissionFamily[] = [
  {
    key: 'perm_problem',
    label: '题目',
    permissions: [
      {
        key: '16',
        name: '创建全部题型',
        detail: '可创建全部八种题型。',
        risk: null,
        includes: [{ key: (1n << 80n).toString(), name: '仅创建本人托管编程题草稿' }],
      },
      {
        key: (1n << 80n).toString(),
        name: '仅创建本人托管编程题草稿',
        detail: '只能建立自己的隐藏草稿。',
        risk: null,
        includes: [],
      },
    ],
  },
  {
    key: 'perm_tasks',
    label: '任务',
    permissions: [
      {
        key: (1n << 73n).toString(),
        name: '管理当前域全部任务',
        detail: '允许维护任务及分配结果。',
        risk: 'high',
        includes: [],
      },
    ],
  },
];

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('domain permission main-sidebar capability', () => {
  it('uses only the server current-domain edit permission and fails closed', () => {
    const errors: unknown[] = [];
    expect(
      resolveDomainPermissionManagementCapability({
        user: { hasPerm: (permission) => permission === 2n },
        editDomainPerm: 2n,
        onError: (error) => errors.push(error),
      }),
    ).to.equal(true);
    expect(
      resolveDomainPermissionManagementCapability({
        user: { hasPerm: () => false },
        editDomainPerm: 2n,
        onError: (error) => errors.push(error),
      }),
    ).to.equal(false);
    expect(
      resolveDomainPermissionManagementCapability({
        user: {},
        editDomainPerm: 2n,
        onError: (error) => errors.push(error),
      }),
    ).to.equal(false);
    expect(errors[0]).to.be.instanceOf(TypeError);
  });
});

describe('domain permission workspace state', () => {
  const permissions = families.flatMap((family) => family.permissions);

  it('round-trips bit 80 and composes a mask without Number coercion', () => {
    const highest = 1n << 80n;
    const selected = permissionKeysFromMask(highest, permissions);
    expect(selected.has(highest.toString())).to.equal(true);
    expect(composeDomainPermissionMask(0n, selected, permissions)).to.equal(highest);
    expect(parseDomainRoleMask(highest.toString(), 'teacher')).to.equal(highest);
  });

  it('searches localized name, detail and family while preserving group order', () => {
    expect(filterDomainPermissionFamilies(families, '草稿').map((family) => family.key)).to.deep.equal(['perm_problem']);
    expect(filterDomainPermissionFamilies(families, '维护任务')[0].permissions[0].name).to.equal('管理当前域全部任务');
    expect(filterDomainPermissionFamilies(families, '题目')[0].permissions).to.have.lengthOf(2);
    expect(filterDomainPermissionFamilies(families, '').map((family) => family.key)).to.deep.equal(['perm_problem', 'perm_tasks']);
  });

  it('keeps a local add/remove draft until the server mask is explicitly replaced', () => {
    const original = new Set(['16']);
    const draft = new Set([(1n << 80n).toString()]);
    const diff = diffDomainPermissionDraft(original, draft, permissions);
    expect(diff.added.map((permission) => permission.name)).to.deep.equal(['仅创建本人托管编程题草稿']);
    expect(diff.removed.map((permission) => permission.name)).to.deep.equal(['创建全部题型']);
  });
});

describe('sudo mutation replay', () => {
  it('replays every selected permission as a repeated form field', () => {
    expect(
      buildSudoReplayFields({
        domainId: 'system',
        operation: 'update',
        permissions: ['1', (1n << 80n).toString()],
        __start: 123,
      }),
    ).to.deep.equal([
      { name: 'domainId', value: 'system' },
      { name: 'operation', value: 'update' },
      { name: 'permissions', value: '1' },
      { name: 'permissions', value: (1n << 80n).toString() },
    ]);
    expect(resolveSudoReplayTarget('POST', '/domain/permission')).to.equal('/domain/permission');
    expect(() => resolveSudoReplayTarget('GET', '/domain/permission')).to.throw(TypeError);
    expect(() => buildSudoReplayFields({ nested: { unsafe: true } })).to.throw(TypeError);
  });
});

describe('domain permission workspace contracts', () => {
  const workspace = source('packages/ui-next/src/pages/domain-permission-workspace.tsx');
  const state = source('packages/ui-next/src/lib/domain-permission-state.ts');
  const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
  const bootstrap = source('packages/ui-next/index.ts');
  const bootstrapTypes = source('packages/ui-next/src/lib/bootstrap.tsx');
  const adminNav = source('packages/ui-next/src/lib/admin-nav-builtins.ts');
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');
  const handler = source('packages/hydrooj/src/handler/domain.ts');
  const userHandler = source('packages/hydrooj/src/handler/user.ts');
  const model = source('packages/hydrooj/src/model/domain.ts');
  const sudo = source('packages/ui-next/src/pages/sudo.tsx');

  it('renders one full-width master-detail workspace with the same narrow-screen business state', () => {
    expect(workspace).to.include('<AdminPage bypassPrivGate hideSidebar');
    expect(workspace).to.include('lg:grid-cols-[17rem_minmax(0,1fr)]');
    expect(workspace).to.include('className="border-b p-4 lg:hidden"');
    expect(workspace).to.include('aria-label="角色列表"');
    expect(workspace).not.to.include('AdminSidebar');
    expect(workspace).not.to.include('transition-all');
  });

  it('keeps drafts local, previews exact differences and retains failures', () => {
    expect(workspace).to.include('有未保存修改');
    expect(workspace).to.include('预览并保存');
    expect(workspace).to.include('确认保存角色权限');
    expect(workspace).to.include('setMutationError(error instanceof Error ? error.message : String(error))');
    expect(workspace).to.include('if (sameKeys(next, originalKeys)) delete updated[selectedRole.id]');
    expect(workspace).to.include('sticky bottom-2');
    expect(state).to.include('diffDomainPermissionDraft');
  });

  it('shows all required role protections and explicit deletion fallback', () => {
    expect(workspace).to.include('root 始终拥有全部域权限');
    expect(workspace).to.include('成员将立即回落到 default 角色');
    expect(workspace).to.include('新角色将复制当前 default');
    expect(workspace).to.include("selectedRole.type === 'custom'");
  });

  it('publishes one capability-gated main-sidebar entry and removes legacy admin navigation', () => {
    expect(bootstrap).to.include('resolveDomainPermissionManagementCapability');
    expect(bootstrap).to.include('editDomainPerm: PERM.PERM_EDIT_DOMAIN');
    expect(bootstrap).to.include('canManageDomainPermissions,');
    expect(bootstrapTypes).to.include('canManageDomainPermissions?: boolean');
    expect(sidebar).to.include('bs.user.canManageDomainPermissions');
    expect(sidebar.match(/label: '权限管理'/g) || []).to.have.lengthOf(1);
    expect(sidebar).to.include('href: bs.urls.domainPermission');
    expect(adminNav).not.to.include("key: 'domain_role'");
    expect(adminNav).not.to.include("key: 'domain_permission'");
  });

  it('keeps the canonical route out of GenericPage and redirects the old role route', () => {
    expect(resolver).to.include("'domain_permission.html': DomainPermissionPage");
    expect(resolver).to.include("'domain_role.html': DomainRolePage");
    expect(handler).to.match(/class DomainRoleHandler[\s\S]*?this\.response\.redirect = this\.url\('domain_permission'\)/);
  });

  it('enforces single-role CAS, sudo, root protection and structured mutation audits on the server', () => {
    expect(handler).to.include('this.checkPerm(PERM.PERM_EDIT_DOMAIN)');
    expect(handler).to.match(/@requireSudo\s+@param\('role', Types\.Role\)\s+@param\('expectedMask'/);
    expect(handler).to.match(/@requireSudo\s+@param\('role', Types\.Role\)\s+async postAdd/);
    expect(handler).to.match(/@requireSudo\s+@param\('role', Types\.Role\)\s+async postDelete/);
    expect(handler).to.include("oplog.log(this, 'domain.role.permissions.update'");
    expect(handler).to.include("oplog.log(this, 'domain.role.create'");
    expect(handler).to.include("oplog.log(this, 'domain.role.delete'");
    for (const field of ['domainId', 'actor', 'role', 'added', 'removed', 'affectedUsers', 'result']) expect(handler).to.include(field);
    expect(model).to.include('compareAndSetRolePermission');
    expect(model).to.include("role === 'root' ? BUILTIN_ROLES.root");
    expect(handler).to.include('resolveCurrentDomainId(domainId, this.domain?._id)');
    expect(handler).to.include("accept.includes('application/json')");
    expect(sudo).to.include('formRef.current.requestSubmit()');
    expect(userHandler).to.include('args: { ...this.session.sudoArgs.args }');
  });
});
