import { useMemo, useState } from 'react';
import { AlertTriangle, KeyRound, LockKeyhole, Plus, RotateCcw, Save, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
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
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function PermissionRow({
  permission,
  checked,
  disabled,
  includers,
  onToggle,
}: {
  permission: DomainPermissionItem;
  checked: boolean;
  disabled: boolean;
  includers: DomainPermissionItem[];
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        'group flex min-h-16 items-start gap-3 px-1 py-3 sm:px-2',
        disabled ? 'cursor-default' : 'cursor-pointer rounded-lg transition-[background-color] duration-150 ease-out hover:bg-muted/45',
      )}
    >
      <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium leading-5">{permission.name}</span>
          {permission.risk === 'high' ? (
            <Badge variant="destructive" className="h-5 px-1.5 text-[10px] font-medium">
              高风险
            </Badge>
          ) : null}
          {permission.includes.length > 0 ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium text-muted-foreground">
              包含 {permission.includes.map((item) => item.name).join('、')}
            </Badge>
          ) : null}
          {includers.length > 0 && !checked ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
              已由 {includers.map((item) => item.name).join('、')} 包含
            </Badge>
          ) : null}
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">{permission.detail}</span>
      </span>
    </label>
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

  return (
    <AdminPage bypassPrivGate hideSidebar contentClassName="min-h-full">
      <section className="min-h-full space-y-5" aria-labelledby="domain-permission-title">
        <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">{domainName} · 当前域</p>
            <h1 id="domain-permission-title" className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <KeyRound className="size-5 text-primary" />
              角色与权限
            </h1>
            <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
              管理当前域的角色权限。这里的域权限不会授予全站管理员能力，账号禁用与全站权限仍在账号管理中维护。
            </p>
          </div>
          <Button
            type="button"
            className="min-h-10 gap-1.5"
            onClick={() => {
              setMutationError(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" />
            新建角色
          </Button>
        </header>

        <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-3 text-sm leading-6">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>权限包含标记只说明实际能力，不会替你勾选或写入其它权限位。root 始终拥有全部域权限，且不可修改或删除。</p>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card/20 shadow-sm lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="hidden border-r bg-muted/20 lg:block" aria-label="角色列表">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-semibold">角色</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{roles.length} 个角色</p>
            </div>
            <ScrollArea className="max-h-[calc(100dvh-15rem)]">
            <div className="space-y-1 p-2">
              {roles.map((role) => {
                const roleMask = parseDomainRoleMask(roleMasks[role.id], role.id);
                const permissionCount = permissionKeysFromMask(roleMask, allPermissions).size;
                const active = role.id === selectedRole.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => {
                      setMutationError(null);
                      setSelectedRoleId(role.id);
                    }}
                    className={cn(
                      'w-full rounded-xl px-3 py-2.5 text-left outline-none transition-[background-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.985]',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      active
                        ? 'bg-background text-foreground shadow-sm ring-1 ring-border/70'
                        : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{role.id}</span>
                      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{roleTypeLabel(role)}</span>
                      {dirtyRoles.has(role.id) ? <span className="size-2 rounded-full bg-primary" title="有未保存修改" /> : null}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] tabular-nums">
                      <span>{role.memberCount} 人</span>
                      <span aria-hidden="true">·</span>
                      <span>{permissionCount} 项权限</span>
                    </span>
                  </button>
                );
              })}
            </div>
            </ScrollArea>
          </aside>

          <main className="min-w-0">
            <div className="border-b p-4 lg:hidden">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">当前角色</label>
              <SimpleSelect
                value={selectedRole.id}
                onValueChange={(value) => {
                  setMutationError(null);
                  setSelectedRoleId(value);
                }}
                className="min-h-11"
                options={roles.map((role) => ({
                  value: role.id,
                  label: `${role.id}${dirtyRoles.has(role.id) ? ' · 未保存' : ''}`,
                }))}
              />
            </div>

            <div className="space-y-5 p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight">{selectedRole.id}</h2>
                    <Badge variant={selectedRole.type === 'custom' ? 'outline' : 'secondary'}>{roleTypeLabel(selectedRole)}</Badge>
                    {!selectedRole.editable ? (
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <LockKeyhole className="size-3" />
                        只读
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {selectedRole.memberCount} 名当前成员
                    </span>
                    <span>
                      {selectedKeys.size} / {allPermissions.length} 项显式权限
                    </span>
                  </div>
                </div>
                {selectedRole.deletable ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10 gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => {
                      setMutationError(null);
                      setDeleteRole(selectedRole);
                    }}
                  >
                    <Trash2 className="size-4" />
                    删除角色
                  </Button>
                ) : null}
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="搜索权限名称、说明或分组"
                  className="min-h-11 pl-9"
                  aria-label="搜索权限"
                />
              </div>

              <MutationError message={!saveOpen && !createOpen && !deleteRole ? mutationError : null} />

              {filteredFamilies.length ? (
                <div className="space-y-7">
                  {filteredFamilies.map((family) => (
                    <section key={family.key} aria-labelledby={`permission-family-${family.key}`}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <h3 id={`permission-family-${family.key}`} className="text-sm font-semibold">
                          {family.label}
                        </h3>
                        <span className="text-xs tabular-nums text-muted-foreground">{family.permissions.length} 项</span>
                      </div>
                      <div className="divide-y border-y">
                        {family.permissions.map((permission) => (
                          <PermissionRow
                            key={permission.key}
                            permission={permission}
                            checked={selectedKeys.has(permission.key)}
                            disabled={!selectedRole.editable}
                            includers={permissionIncluders(permission.key, selectedKeys, allPermissions)}
                            onToggle={() => togglePermission(permission.key)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                  没有匹配“{query.trim()}”的权限。
                </div>
              )}

              {selectedDirty && selectedRole.editable ? (
                <div className="sticky bottom-2 z-10 flex flex-col gap-3 rounded-xl border bg-background p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{selectedRole.id} 有未保存修改</p>
                    <p className="text-xs text-muted-foreground">
                      新增 {selectedDiff.added.length} 项，移除 {selectedDiff.removed.length} 项
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" className="min-h-10 gap-1.5" onClick={() => updateDraft(new Set(originalKeys))}>
                      <RotateCcw className="size-3.5" />
                      撤销草稿
                    </Button>
                    <Button
                      type="button"
                      className="min-h-10 gap-1.5"
                      onClick={() => {
                        setMutationError(null);
                        setSaveOpen(true);
                      }}
                    >
                      <Save className="size-3.5" />
                      预览并保存
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
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
        <DialogContent className="sm:w-[620px] sm:rounded-2xl" onClose={busy ? undefined : () => setSaveOpen(false)}>
          <DialogHeader>
            <DialogTitle>确认保存角色权限</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              角色 {selectedRole.id} · 当前影响 {selectedRole.memberCount} 名成员
            </p>
          </DialogHeader>
          <DialogBody className="space-y-4 px-6 py-5">
            <MutationError message={mutationError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">新增 {selectedDiff.added.length} 项</p>
                {selectedDiff.added.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {selectedDiff.added.map((permission) => (
                      <li key={permission.key}>{permission.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">无新增权限</p>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-destructive">移除 {selectedDiff.removed.length} 项</p>
                {selectedDiff.removed.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {selectedDiff.removed.map((permission) => (
                      <li key={permission.key}>{permission.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">无移除权限</p>
                )}
              </div>
            </div>
          </DialogBody>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="ghost" className="min-h-10" disabled={busy} onClick={() => setSaveOpen(false)}>
              取消
            </Button>
            <Button type="button" className="min-h-10" disabled={busy} onClick={() => void handleSave()}>
              {busy ? '保存中…' : '确认保存'}
            </Button>
          </div>
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
        <DialogContent className="sm:w-[520px] sm:rounded-2xl" onClose={busy ? undefined : () => setCreateOpen(false)}>
          <DialogHeader>
            <DialogTitle>新建域角色</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">新角色将复制当前 default 的 {defaultPermissionCount} 项权限，创建后可继续调整。</p>
          </DialogHeader>
          <DialogBody className="space-y-4 px-6 py-5">
            <MutationError message={mutationError} />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">角色名</span>
              <Input
                autoFocus
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.currentTarget.value)}
                placeholder="仅限字母、数字和下划线"
                className="min-h-11"
                maxLength={32}
              />
            </label>
          </DialogBody>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="ghost" className="min-h-10" disabled={busy} onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="button" className="min-h-10" disabled={busy || !newRoleName.trim()} onClick={() => void handleCreate()}>
              {busy ? '创建中…' : '创建角色'}
            </Button>
          </div>
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
        <DialogContent className="sm:w-[520px] sm:rounded-2xl" onClose={busy ? undefined : () => setDeleteRole(null)}>
          <DialogHeader>
            <DialogTitle>删除自定义角色</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 px-6 py-5">
            <MutationError message={mutationError} />
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <p className="font-medium">删除 {deleteRole?.id}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                当前 {deleteRole?.memberCount ?? 0} 名成员将立即回落到 default 角色。此操作不会删除账号或其它角色。
              </p>
            </div>
          </DialogBody>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="ghost" className="min-h-10" disabled={busy} onClick={() => setDeleteRole(null)}>
              取消
            </Button>
            <Button type="button" variant="destructive" className="min-h-10" disabled={busy} onClick={() => void handleDelete()}>
              {busy ? '删除中…' : '确认删除'}
            </Button>
          </div>
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
      <div className="rounded-xl border p-6 text-sm">
        角色管理已合并到权限管理。
        <a className="ml-1 font-medium text-primary underline-offset-4 hover:underline" href={endpoint}>
          前往角色与权限
        </a>
      </div>
    </AdminPage>
  );
}
