import { useMemo, useState } from 'react';
import { LockKeyhole, Plus, RotateCcw, Save, Search, Trash2, Users } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input, SearchInput } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import {
  composeDomainPermissionMask,
  diffDomainPermissionDraft,
  filterDomainPermissionFamilies,
  flattenDomainPermissions,
  parseDomainRoleMask,
  permissionIncluders,
  permissionKeysFromMask,
  type DomainPermissionFamily,
  type DomainPermissionItem,
} from '@/lib/domain-permission-state';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { resolveSudoChallengeUrl } from '@/lib/sudo-replay';

interface DomainPermissionRole {
  id: string;
  perm: string;
  memberCount: number;
  type: 'root' | 'builtin' | 'custom';
  editable: boolean;
  deletable: boolean;
}

interface DomainPermissionWorkspaceProps {
  domainName: string;
  endpoint: string;
  initialRoles: DomainPermissionRole[];
  permissionFamilies: DomainPermissionFamily[];
}

type PermissionDrafts = Record<string, Set<string>>;

function sortRoles(roles: DomainPermissionRole[]) {
  const order = new Map([
    ['root', 0],
    ['default', 1],
    ['teacher', 2],
    ['guest', 3],
  ]);
  return [...roles].sort((left, right) => (order.get(left.id) ?? 10) - (order.get(right.id) ?? 10) || left.id.localeCompare(right.id));
}

function roleTypeLabel(role: DomainPermissionRole) {
  if (role.type === 'root') return '超级角色';
  if (role.type === 'builtin') return '内置角色';
  return '自定义角色';
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

async function postRoleOperation(endpoint: string, fields: Record<string, string>, permissions: readonly string[] = []) {
  const body = new URLSearchParams(fields);
  for (const permission of permissions) body.append('permissions', permission);
  const response = await fetchHydroResponse(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
  });
  if (response.redirected) {
    const sudoUrl = resolveSudoChallengeUrl({ url: response.url }, window.location.href);
    if (!sudoUrl) throw new Error('权限操作发生了非预期重定向');
    window.location.assign(sudoUrl);
    throw new Error('正在跳转到身份验证页面…');
  }
  if (!response.ok) throw new Error(await readHydroResponseError(response, '权限操作失败'));
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('服务器未返回明确的 JSON 成功结果');
  const payload: unknown = await response.json();
  const sudoUrl = resolveSudoChallengeUrl(payload, window.location.href);
  if (sudoUrl) {
    window.location.assign(sudoUrl);
    throw new Error('正在跳转到身份验证页面…');
  }
  if (!payload || typeof payload !== 'object' || (payload as { ok?: unknown }).ok !== true) throw new Error('服务器未确认权限操作成功');
  return payload as Record<string, unknown>;
}

function MutationError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert tone="danger">{message}</Alert>;
}

function permissionRowId(key: string) {
  return `domain-permission-bit-${key}`;
}

function PermissionMarks({
  permission,
  checked,
  includers,
}: {
  permission: DomainPermissionItem;
  checked: boolean;
  includers: DomainPermissionItem[];
}) {
  return (
    <>
      {permission.risk === 'high' ? (
        <Badge tone="danger" variant="soft" size="sm">高风险</Badge>
      ) : null}
      {permission.includes.length > 0 ? (
        <Badge variant="outline" size="sm">
          包含 {permission.includes.map((item) => item.name).join('、')}
        </Badge>
      ) : null}
      {includers.length > 0 && !checked ? (
        <Badge tone="neutral" variant="soft" size="sm">
          已由 {includers.map((item) => item.name).join('、')} 包含
        </Badge>
      ) : null}
    </>
  );
}

export function DomainPermissionWorkspace({ domainName, endpoint, initialRoles, permissionFamilies }: DomainPermissionWorkspaceProps) {
  if (!endpoint) throw new Error('域权限写入地址缺失');
  if (!initialRoles.length) throw new Error('域角色列表为空');
  if (!permissionFamilies.length) throw new Error('域权限目录为空');

  const allPermissions = useMemo(() => flattenDomainPermissions(permissionFamilies), [permissionFamilies]);
  if (new Set(allPermissions.map((permission) => permission.key)).size !== allPermissions.length) {
    throw new Error('域权限目录存在重复权限位');
  }

  const [roles, setRoles] = useState(() => sortRoles(initialRoles));
  const [roleMasks, setRoleMasks] = useState<Record<string, string>>(() => Object.fromEntries(initialRoles.map((role) => [role.id, role.perm])));
  const [selectedRoleId, setSelectedRoleId] = useState(() => initialRoles.find((role) => role.id === 'default')?.id || initialRoles[0].id);
  const [drafts, setDrafts] = useState<PermissionDrafts>({});
  const [query, setQuery] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteRole, setDeleteRole] = useState<DomainPermissionRole | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) || roles[0];
  const originalMask = parseDomainRoleMask(roleMasks[selectedRole.id], selectedRole.id);
  const originalKeys = useMemo(() => permissionKeysFromMask(originalMask, allPermissions), [originalMask, allPermissions]);
  const selectedKeys = drafts[selectedRole.id] || originalKeys;
  const selectedDiff = diffDomainPermissionDraft(originalKeys, selectedKeys, allPermissions);
  const selectedDirty = selectedDiff.added.length > 0 || selectedDiff.removed.length > 0;
  const filteredFamilies = useMemo(() => filterDomainPermissionFamilies(permissionFamilies, query), [permissionFamilies, query]);

  const dirtyRoles = useMemo(() => {
    const dirty = new Set<string>();
    for (const role of roles) {
      const draft = drafts[role.id];
      if (!draft) continue;
      const mask = parseDomainRoleMask(roleMasks[role.id], role.id);
      if (!sameKeys(draft, permissionKeysFromMask(mask, allPermissions))) dirty.add(role.id);
    }
    return dirty;
  }, [allPermissions, drafts, roleMasks, roles]);

  const updateDraft = (next: Set<string>) => {
    setDrafts((current) => {
      const updated = { ...current };
      if (sameKeys(next, originalKeys)) delete updated[selectedRole.id];
      else updated[selectedRole.id] = next;
      return updated;
    });
  };

  const togglePermission = (key: string) => {
    if (!selectedRole.editable) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateDraft(next);
  };

  const handleSave = async () => {
    if (!selectedRole.editable || !selectedDirty || busy) return;
    setBusy(true);
    setMutationError(null);
    try {
      const mask = composeDomainPermissionMask(originalMask, selectedKeys, allPermissions);
      const payload = await postRoleOperation(
        endpoint,
        {
          operation: 'update',
          role: selectedRole.id,
          expectedMask: originalMask.toString(),
          mask: mask.toString(),
        },
        allPermissions.filter((permission) => selectedKeys.has(permission.key)).map((permission) => permission.key),
      );
      if (payload.operation !== 'update' || payload.role !== selectedRole.id || String(payload.mask) !== mask.toString()) {
        throw new Error('服务器返回的角色权限结果与本次保存不一致');
      }
      setRoleMasks((current) => ({ ...current, [selectedRole.id]: mask.toString() }));
      setRoles((current) => current.map((role) => (role.id === selectedRole.id ? { ...role, perm: mask.toString() } : role)));
      setDrafts((current) => {
        const next = { ...current };
        delete next[selectedRole.id];
        return next;
      });
      setSaveOpen(false);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const role = newRoleName.trim();
    if (!role || busy) return;
    setBusy(true);
    setMutationError(null);
    try {
      const payload = await postRoleOperation(endpoint, { operation: 'add', role });
      const created = payload.role as DomainPermissionRole;
      if (payload.operation !== 'add' || !created || created.id !== role || created.type !== 'custom') {
        throw new Error('服务器返回的新角色结果无效');
      }
      parseDomainRoleMask(created.perm, created.id);
      setRoles((current) => sortRoles([...current, created]));
      setRoleMasks((current) => ({ ...current, [created.id]: created.perm }));
      setSelectedRoleId(created.id);
      setNewRoleName('');
      setCreateOpen(false);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteRole || !deleteRole.deletable || busy) return;
    setBusy(true);
    setMutationError(null);
    try {
      const payload = await postRoleOperation(endpoint, { operation: 'delete', role: deleteRole.id });
      if (payload.operation !== 'delete' || payload.role !== deleteRole.id || payload.fallbackRole !== 'default') {
        throw new Error('服务器返回的删除角色结果无效');
      }
      setRoles((current) =>
        current
          .filter((role) => role.id !== deleteRole.id)
          .map((role) => (role.id === 'default' ? { ...role, memberCount: role.memberCount + deleteRole.memberCount } : role)),
      );
      setRoleMasks((current) => {
        const next = { ...current };
        delete next[deleteRole.id];
        return next;
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[deleteRole.id];
        return next;
      });
      if (selectedRoleId === deleteRole.id) setSelectedRoleId(roles.find((role) => role.id === 'default')?.id || roles[0].id);
      setDeleteRole(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const defaultRole = roles.find((role) => role.id === 'default');
  const defaultPermissionCount = defaultRole ? permissionKeysFromMask(parseDomainRoleMask(roleMasks.default, 'default'), allPermissions).size : 0;
  const dialogOpen = saveOpen || createOpen || deleteRole !== null;
  const headerPrimary = !selectedDirty && !dialogOpen;
  const savePrimary = selectedDirty && !dialogOpen;

  return (
    <AdminPage
      bypassPrivGate
      hideSidebar
      title="角色与权限"
      description={(
        <>
          {domainName} · 当前域
          <br />
          管理当前域的角色权限。这里的域权限不会授予全站管理员能力，账号禁用与全站权限仍在账号管理中维护。
        </>
      )}
      actions={(
        <Button
          type="button"
          variant={headerPrimary ? 'primary' : 'secondary'}
          onClick={() => {
            setMutationError(null);
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
          新建角色
        </Button>
      )}
    >
      <section className="flex min-w-0 flex-col gap-5" aria-labelledby="domain-permission-title">
        <span id="domain-permission-title" className="sr-only">角色与权限</span>
        <Alert tone="info">
          权限包含标记只说明实际能力，不会替你勾选或写入其它权限位。root 始终拥有全部域权限，且不可修改或删除。
        </Alert>

        <div className="min-w-0 rounded-lg border border-line bg-surface shadow-xs lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="hidden min-w-0 overflow-hidden border-r border-line bg-surface-sunken lg:block" aria-label="角色列表">
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-fg">角色</p>
              <p className="mt-0.5 text-xs text-fg-subtle">{roles.length} 个角色</p>
            </div>
            <div className="flex flex-col gap-1 p-2">
              {roles.map((role) => {
                const roleMask = parseDomainRoleMask(roleMasks[role.id], role.id);
                const permissionCount = permissionKeysFromMask(roleMask, allPermissions).size;
                const active = role.id === selectedRole.id;
                return (
                  <Button
                    key={role.id}
                    type="button"
                    variant={active ? 'secondary' : 'ghost'}
                    aria-pressed={active}
                    className="h-auto! w-full min-w-0 max-w-full whitespace-normal py-1.5"
                    onClick={() => {
                      setMutationError(null);
                      setSelectedRoleId(role.id);
                    }}
                  >
                    <span className="flex w-full min-w-0 flex-col gap-0.5 text-left">
                      <span className="min-w-0 truncate">{role.id}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-subtle">
                        {dirtyRoles.has(role.id) ? (
                          <span className="inline-flex shrink-0" title="有未保存修改">
                            <StatusDot tone="warning" />
                            <span className="sr-only">有未保存修改</span>
                          </span>
                        ) : null}
                        <span className="shrink-0">{roleTypeLabel(role)}</span>
                        <span className="min-w-0 truncate tabular">
                          {role.memberCount} 人
                          <span aria-hidden="true"> · </span>
                          {permissionCount} 项权限
                        </span>
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0">
            <div className="border-b border-line p-4 lg:hidden">
              <FormField label="当前角色" htmlFor="domain-permission-role">
                <SimpleSelect
                  id="domain-permission-role"
                  value={selectedRole.id}
                  onValueChange={(value) => {
                    setMutationError(null);
                    setSelectedRoleId(value);
                  }}
                  options={roles.map((role) => ({
                    value: role.id,
                    label: `${role.id} · ${role.memberCount} 人${dirtyRoles.has(role.id) ? ' · 未保存' : ''}`,
                  }))}
                />
              </FormField>
            </div>

            <div className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight text-balance text-fg">{selectedRole.id}</h2>
                    <Badge variant={selectedRole.type === 'custom' ? 'outline' : 'soft'}>{roleTypeLabel(selectedRole)}</Badge>
                    {!selectedRole.editable ? (
                      <Badge tone="neutral" variant="soft">
                        <LockKeyhole aria-hidden="true" className="size-3.5" />
                        只读
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <Users aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
                      {selectedRole.memberCount} 名当前成员
                    </span>
                    <span className="tabular">
                      {selectedKeys.size} / {allPermissions.length} 项显式权限
                    </span>
                  </div>
                </div>
                {selectedRole.deletable ? (
                  <Button
                    type="button"
                    variant="danger-soft"
                    className="shrink-0"
                    onClick={() => {
                      setMutationError(null);
                      setDeleteRole(selectedRole);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    删除角色
                  </Button>
                ) : null}
              </div>

              <SearchInput
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索权限名称、说明或分组"
                aria-label="搜索权限"
              />

              <MutationError message={!saveOpen && !createOpen && !deleteRole ? mutationError : null} />

              {filteredFamilies.length ? (
                <div className="flex min-w-0 flex-col gap-6">
                  {filteredFamilies.map((family) => (
                    <section key={family.key} className="flex min-w-0 flex-col gap-2" aria-labelledby={`permission-family-${family.key}`}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 id={`permission-family-${family.key}`} className="min-w-0 truncate text-sm font-semibold text-fg">
                          {family.label}
                        </h3>
                        <span className="shrink-0 text-xs tabular text-fg-subtle">{family.permissions.length} 项</span>
                      </div>
                      <div className="min-w-0 [&_.krypton-table-shell]:max-h-96 [&_[data-radix-scroll-area-viewport]>div]:!block">
                        <Table orientation="both">
                          <TableHeader className="sticky top-0 z-10">
                            <TableRow>
                              <TableHead className="sticky top-0 z-10 w-12 bg-surface-sunken">
                                <span className="sr-only">勾选</span>
                              </TableHead>
                              <TableHead className="sticky top-0 z-10 bg-surface-sunken">权限</TableHead>
                              <TableHead className="sticky top-0 z-10 bg-surface-sunken">说明</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {family.permissions.map((permission) => {
                              const checked = selectedKeys.has(permission.key);
                              const includers = permissionIncluders(permission.key, selectedKeys, allPermissions);
                              return (
                                <TableRow key={permission.key}>
                                  <TableCell>
                                    <Checkbox
                                      size="sm"
                                      id={permissionRowId(permission.key)}
                                      checked={checked}
                                      disabled={!selectedRole.editable}
                                      onCheckedChange={() => togglePermission(permission.key)}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <label
                                      htmlFor={permissionRowId(permission.key)}
                                      className="flex min-w-0 items-center gap-2 whitespace-nowrap"
                                    >
                                      <span className="font-medium">{permission.name}</span>
                                      <PermissionMarks permission={permission} checked={checked} includers={includers} />
                                    </label>
                                  </TableCell>
                                  <TableCell>
                                    <label htmlFor={permissionRowId(permission.key)} className="block whitespace-nowrap text-fg-muted">
                                      {permission.detail}
                                    </label>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <EmptyState compact icon={<Search />} title={`没有匹配“${query.trim()}”的权限。`} />
              )}
            </div>
            {selectedDirty && selectedRole.editable ? (
              <div className="sticky bottom-2 z-20 flex flex-col gap-3 border-t border-line bg-surface px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{selectedRole.id} 有未保存修改</p>
                  <p className="text-xs tabular text-fg-subtle">
                    新增 {selectedDiff.added.length} 项，移除 {selectedDiff.removed.length} 项
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" onClick={() => updateDraft(new Set(originalKeys))}>
                    <RotateCcw aria-hidden="true" />
                    撤销草稿
                  </Button>
                  <Button
                    type="button"
                    variant={savePrimary ? 'primary' : 'secondary'}
                    onClick={() => {
                      setMutationError(null);
                      setSaveOpen(true);
                    }}
                  >
                    <Save aria-hidden="true" />
                    预览并保存
                  </Button>
                </div>
              </div>
            ) : null}
          </main>
        </div>
      </section>

      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setSaveOpen(open);
            if (!open) setMutationError(null);
          }
        }}
      >
        <DialogContent size="lg" onClose={busy ? undefined : () => setSaveOpen(false)}>
          <DialogHeader>
            <DialogTitle>确认保存角色权限</DialogTitle>
            <DialogDescription>
              角色 {selectedRole.id} · 当前影响 {selectedRole.memberCount} 名成员
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <MutationError message={mutationError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-sm font-medium text-success-fg">新增 {selectedDiff.added.length} 项</p>
                {selectedDiff.added.length ? (
                  <ul className="flex flex-col gap-1.5 text-sm text-fg">
                    {selectedDiff.added.map((permission) => (
                      <li key={permission.key} className="min-w-0 break-words">{permission.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-fg-muted">无新增权限</p>
                )}
              </div>
              <div className="min-w-0">
                <p className="mb-2 text-sm font-medium text-danger-fg">移除 {selectedDiff.removed.length} 项</p>
                {selectedDiff.removed.length ? (
                  <ul className="flex flex-col gap-1.5 text-sm text-fg">
                    {selectedDiff.removed.map((permission) => (
                      <li key={permission.key} className="min-w-0 break-words">{permission.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-fg-muted">无移除权限</p>
                )}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setSaveOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => void handleSave()}>
              {busy ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setCreateOpen(open);
            if (!open) setMutationError(null);
          }
        }}
      >
        <DialogContent size="md" onClose={busy ? undefined : () => setCreateOpen(false)}>
          <DialogHeader>
            <DialogTitle>新建域角色</DialogTitle>
            <DialogDescription>新角色将复制当前 default 的 {defaultPermissionCount} 项权限，创建后可继续调整。</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <MutationError message={mutationError} />
            <FormField label="角色名" htmlFor="domain-permission-new-role">
              <Input
                id="domain-permission-new-role"
                autoFocus
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.currentTarget.value)}
                placeholder="仅限字母、数字和下划线"
                maxLength={32}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="button" variant="primary" disabled={busy || !newRoleName.trim()} onClick={() => void handleCreate()}>
              {busy ? '创建中…' : '创建角色'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteRole}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleteRole(null);
            setMutationError(null);
          }
        }}
      >
        <DialogContent size="md" onClose={busy ? undefined : () => setDeleteRole(null)}>
          <DialogHeader>
            <DialogTitle>删除自定义角色</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <MutationError message={mutationError} />
            <Alert tone="danger" title={`删除 ${deleteRole?.id ?? ''}`}>
              当前 {deleteRole?.memberCount ?? 0} 名成员将立即回落到 default 角色。此操作不会删除账号或其它角色。
            </Alert>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleteRole(null)}>
              取消
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void handleDelete()}>
              {busy ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}

export function DomainPermissionPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    domain?: { name?: string };
    permissionEndpoint?: string;
    permissionFamilies?: DomainPermissionFamily[];
    roles?: DomainPermissionRole[];
  };
  if (!Array.isArray(data.roles) || !Array.isArray(data.permissionFamilies)) {
    throw new TypeError('域权限工作区缺少服务端角色或权限目录');
  }
  return (
    <DomainPermissionWorkspace
      domainName={String(data.domain?.name || bs.domain.name)}
      endpoint={String(data.permissionEndpoint || bs.urls.domainPermission)}
      initialRoles={data.roles as DomainPermissionRole[]}
      permissionFamilies={data.permissionFamilies as DomainPermissionFamily[]}
    />
  );
}

export function DomainRolePage() {
  const endpoint = useBootstrap().urls.domainPermission;
  return (
    <AdminPage bypassPrivGate hideSidebar>
      <Panel>
        <p className="text-sm text-fg">
          角色管理已合并到权限管理。
          <a
            className="ml-1 font-medium text-brand-fg underline underline-offset-2 decoration-brand-line hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href={endpoint}
          >
            前往角色与权限
          </a>
        </p>
      </Panel>
    </AdminPage>
  );
}
