/**
 * Domain management pages — edit, users and groups.
 */

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown, FileUp, Plus, Save, Search, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { AdminPage } from '@/components/admin/admin-page';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import {
  filterDomainUsers,
  flattenDomainUsers,
  getSelectableDomainUserIds,
  paginateDomainUsers,
  type DomainUserRow,
} from '@/lib/domain-user-workspace';

type R = Record<string, any>;

/* ================================================================== */
/*  Shared layout for domain admin pages                               */
/* ================================================================== */

function DomainAdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <AdminPage bypassPrivGate title={title}>
      {children}
    </AdminPage>
  );
}

/* ================================================================== */
/*  Settings field renderer (reused from user-account pattern)         */
/* ================================================================== */

function SettingField({ setting, value }: { setting: R; value: any }) {
  const isDisabled = !!(setting.flag & 2);

  return (
    <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-start">
      <div>
        <label className="text-sm font-medium">{setting.name || setting.key}</label>
        {setting.desc ? <p className="text-[11px] leading-tight text-muted-foreground">{setting.desc}</p> : null}
      </div>
      <div>
        {setting.type === 'boolean' || setting.type === 'checkbox' ? (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Checkbox name={setting.key} defaultChecked={!!value} disabled={isDisabled} />
            <span className="text-sm text-muted-foreground">{setting.ui || '启用'}</span>
          </label>
        ) : setting.type === 'select' ? (
          <SimpleSelect
            name={setting.key}
            defaultValue={String(value ?? setting.value ?? '')}
            disabled={isDisabled}
            options={rangeOptions(setting.range)}
          />
        ) : setting.type === 'markdown' && !isDisabled ? (
          <MarkdownEditor name={setting.key} value={value ?? setting.value ?? ''} minHeight={260} />
        ) : setting.type === 'textarea' || setting.type === 'markdown' ? (
          <textarea
            name={setting.key}
            defaultValue={value ?? setting.value ?? ''}
            disabled={isDisabled}
            rows={setting.type === 'markdown' ? 6 : 3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
          />
        ) : setting.type === 'number' || setting.type === 'float' ? (
          <Input
            type="number"
            name={setting.key}
            defaultValue={value ?? setting.value ?? ''}
            disabled={isDisabled}
            step={setting.type === 'float' ? 'any' : '1'}
            className="max-w-xs"
          />
        ) : setting.type === 'password' ? (
          <Input type="password" name={setting.key} defaultValue="" disabled={isDisabled} autoComplete="new-password" className="max-w-xs" />
        ) : (
          <Input name={setting.key} defaultValue={value ?? setting.value ?? ''} disabled={isDisabled} className="max-w-sm" />
        )}
      </div>
    </div>
  );
}

/**
 * Inline role picker for the user roster — re-submits the surrounding form
 * (`<form method="post">`) whenever the user picks a new role. We render a
 * hidden `<input name="role">` ourselves so the change handler can find the
 * native form via the input's `form` property; the SimpleSelect popover
 * lives in a Portal, so `event.currentTarget.form` won't reach the row.
 */
function RoleQuickSelect({
  defaultValue,
  roleOptions,
  ariaLabel = '修改域角色',
  disabled = false,
}: {
  defaultValue: string;
  roleOptions: string[];
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input ref={inputRef} type="hidden" name="role" defaultValue={defaultValue} />
      <SimpleSelect
        defaultValue={defaultValue}
        size="sm"
        className="h-10 text-xs"
        ariaLabel={ariaLabel}
        disabled={disabled}
        options={roleOptions.map((option) => ({ value: option, label: option }))}
        onValueChange={(v) => {
          if (inputRef.current) {
            inputRef.current.value = v;
            inputRef.current.form?.requestSubmit();
          }
        }}
      />
    </>
  );
}

function rangeOptions(range: any): { value: string; label: string }[] {
  if (!range) return [];
  if (Array.isArray(range)) {
    return range.map((opt: any) => {
      const val = Array.isArray(opt) ? opt[0] : opt;
      const label = Array.isArray(opt) ? opt[1] || opt[0] : opt;
      return { value: String(val), label: String(label) };
    });
  }
  return Object.entries(range).map(([val, label]) => ({
    value: val,
    label: String(label),
  }));
}

/* ================================================================== */
/*  Domain Edit                                                        */
/* ================================================================== */

export function DomainEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const current: R = data.current || {};
  const settings: R[] = data.settings || [];

  const families = new Map<string, R[]>();
  for (const s of settings) {
    if (s.flag & 1) continue; // FLAG_HIDDEN
    const fam = s.family || 'general';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(s);
  }

  const familyLabels: Record<string, string> = {
    setting_domain: '域信息',
    setting_storage: '存储',
    setting_basic: '基本',
    general: '通用',
  };

  return (
    <DomainAdminShell title="编辑域">
      <Card>
        <CardContent className="p-5">
          <form method="post" className="space-y-6">
            {Array.from(families.entries()).map(([fam, items]) => (
              <fieldset key={fam} className="space-y-4">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{familyLabels[fam] || fam}</legend>
                {items.map((setting) => (
                  <SettingField key={setting.key} setting={setting} value={current[setting.key]} />
                ))}
              </fieldset>
            ))}
            <Separator />
            <div className="flex justify-end">
              <Button type="submit">保存</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </DomainAdminShell>
  );
}

/* ================================================================== */
/*  Domain Users                                                       */
/* ================================================================== */

const ADD_DOMAIN_USERS_DIALOG_TITLE_ID = 'add-domain-users-dialog-title';
const REMOVE_DOMAIN_USERS_DIALOG_TITLE_ID = 'remove-domain-users-dialog-title';
const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function trapDialogFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true',
  );
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function restoreDialogTrigger(trigger: React.RefObject<HTMLElement | null>) {
  window.requestAnimationFrame(() => trigger.current?.focus());
}

function AddDomainUsersDialog({
  open,
  onClose,
  roleOptions,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  roleOptions: string[];
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const close = () => {
    onClose();
    restoreDialogTrigger(returnFocusRef);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <form method="post">
        <DialogContent
          className="w-full sm:w-[560px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={ADD_DOMAIN_USERS_DIALOG_TITLE_ID}
          onKeyDown={trapDialogFocus}
        >
          <DialogHeader>
            <DialogTitle id={ADD_DOMAIN_USERS_DIALOG_TITLE_ID} className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" />
              添加或更新域用户
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">一次可填写多个 UID，并为这些账号统一设置当前域角色。</p>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-5 px-5 py-4">
              <input type="hidden" name="operation" value="set_users" />
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="domain-user-uids">
                  用户 UID
                </label>
                <Input className="h-10" id="domain-user-uids" name="uids" placeholder="例如：1001, 1002, 1003" autoFocus required />
                <p className="text-xs text-muted-foreground">使用英文逗号分隔多个 UID。</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="domain-user-role">
                  域角色
                </label>
                <SimpleSelect
                  id="domain-user-role"
                  name="role"
                  defaultValue={roleOptions[0]}
                  className="h-10"
                  options={roleOptions.map((role) => ({ value: role, label: role }))}
                />
              </div>
              <label className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
                <Checkbox name="join" value="true" className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">标记为已加入</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">同步更新这些用户在当前域中的加入状态。</span>
                </span>
              </label>
            </div>
          </DialogBody>
          <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" className="h-10" onClick={close}>
              取消
            </Button>
            <Button type="submit" className="h-10" disabled={roleOptions.length === 0}>
              <UserPlus className="size-4" />
              保存用户
            </Button>
          </div>
        </DialogContent>
      </form>
    </Dialog>
  );
}

function RemoveDomainUsersDialog({
  users,
  onClose,
  returnFocusRef,
}: {
  users: DomainUserRow[];
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const close = () => {
    onClose();
    restoreDialogTrigger(returnFocusRef);
  };
  return (
    <Dialog open={users.length > 0} onOpenChange={(next) => !next && close()}>
      <form method="post">
        <DialogContent
          className="w-full sm:w-[520px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={REMOVE_DOMAIN_USERS_DIALOG_TITLE_ID}
          onKeyDown={trapDialogFocus}
        >
          <DialogHeader>
            <DialogTitle id={REMOVE_DOMAIN_USERS_DIALOG_TITLE_ID} className="flex items-center gap-2">
              <UserMinus className="size-4 text-destructive" />
              确认移除域用户
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">这会移除所选账号在当前域中的成员身份。</p>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-3 px-5 py-4">
              <input type="hidden" name="operation" value="kick" />
              {users.map((user) => (
                <input key={user.uid} type="hidden" name="uids" value={user.uid} />
              ))}
              <div className="rounded-lg border bg-muted/20">
                {users.slice(0, 8).map((user) => (
                  <div key={user.uid} className="flex items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" title={user.displayName || user.uname || `UID ${user.uid}`}>
                        {user.displayName || user.uname || `UID ${user.uid}`}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={user.uname || undefined}>
                        {user.uname ? `@${user.uname} · ` : ''}
                        UID {user.uid}
                      </p>
                    </div>
                    <Badge variant="outline">{user.role}</Badge>
                  </div>
                ))}
              </div>
              {users.length > 8 ? <p className="text-xs text-muted-foreground">以及另外 {users.length - 8} 名用户</p> : null}
            </div>
          </DialogBody>
          <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" className="h-10" autoFocus onClick={close}>
              取消
            </Button>
            <Button type="submit" variant="destructive" className="h-10">
              <UserMinus className="size-4" />
              移除 {users.length} 名用户
            </Button>
          </div>
        </DialogContent>
      </form>
    </Dialog>
  );
}

export function DomainUserPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const roles: R[] = data.roles || [];
  const rudocs: R = data.rudocs || {};
  const roleOptions = roles.map((role) => String(role._id || role)).filter((role) => role !== 'guest');
  const assignableRoles = roleOptions.filter((role) => role !== 'default');
  const rows = flattenDomainUsers(rudocs, roleOptions);
  const ownerUid = String(data.domain?.owner ?? '');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [removeUsers, setRemoveUsers] = useState<DomainUserRow[]>([]);
  const addReturnFocusRef = useRef<HTMLElement | null>(null);
  const removeReturnFocusRef = useRef<HTMLElement | null>(null);
  const filteredRows = filterDomainUsers(rows, search, roleFilter);
  const roster = paginateDomainUsers(filteredRows, page);
  const selectedList = Array.from(selectedUsers);
  const selectedRows = rows.filter((user) => user.uid !== ownerUid && selectedUsers.has(user.uid));
  const visibleIds = getSelectableDomainUserIds(roster.items, ownerUid);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((uid) => selectedUsers.has(uid));
  const partlyVisibleSelected = visibleIds.some((uid) => selectedUsers.has(uid)) && !allVisibleSelected;
  const manageableRoleCount = roleOptions.length;

  const resetViewSelection = () => setSelectedUsers(new Set());
  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    resetViewSelection();
  };
  const updateRoleFilter = (value: string) => {
    setRoleFilter(value);
    setPage(1);
    resetViewSelection();
  };
  const changePage = (nextPage: number) => {
    setPage(nextPage);
    resetViewSelection();
  };
  const toggleUser = (uid: string) => {
    if (uid === ownerUid) return;
    setSelectedUsers((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };
  const toggleVisible = (checked: boolean) => {
    setSelectedUsers(checked ? new Set(visibleIds) : new Set());
  };
  const openAddDialog = (event: React.MouseEvent<HTMLButtonElement>) => {
    addReturnFocusRef.current = event.currentTarget;
    setAddOpen(true);
  };
  const openRemoveDialog = (users: DomainUserRow[], trigger: HTMLElement) => {
    removeReturnFocusRef.current = trigger;
    setRemoveUsers(users);
  };

  return (
    <DomainAdminShell title="域用户">
      <div className="space-y-5">
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Users className="size-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{String(data.domain?.name || bs.domain.name || '当前域')}</h2>
                <p className="text-sm text-muted-foreground">集中查看成员、加入状态和域角色。</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <span>
                <strong className="font-semibold tabular-nums">{rows.length}</strong> <span className="text-muted-foreground">名成员</span>
              </span>
              <span>
                <strong className="font-semibold tabular-nums">{manageableRoleCount}</strong>{' '}
                <span className="text-muted-foreground">个可管理角色</span>
              </span>
              <span>
                <strong className="font-semibold tabular-nums">{filteredRows.length}</strong>{' '}
                <span className="text-muted-foreground">条当前结果</span>
              </span>
              <span>
                <strong className="font-semibold tabular-nums">{selectedList.length}</strong> <span className="text-muted-foreground">名已选择</span>
              </span>
            </div>
          </div>
          <Button type="button" className="h-10" onClick={openAddDialog}>
            <UserPlus className="size-4" />
            添加或更新用户
          </Button>
        </section>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/10 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="text-base">成员目录</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">搜索展示名、用户名或 UID；角色可直接在表格中修改。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(240px,1fr)_180px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-10 pl-9"
                    aria-label="搜索域用户"
                    placeholder="搜索展示名、用户名或 UID"
                    value={search}
                    onChange={(event) => updateSearch(event.target.value)}
                  />
                </div>
                <SimpleSelect
                  value={roleFilter}
                  onValueChange={updateRoleFilter}
                  ariaLabel="按域角色筛选"
                  className="h-10"
                  options={[{ value: '', label: '全部角色' }, ...roleOptions.map((role) => ({ value: role, label: role }))]}
                />
              </div>
            </div>
          </CardHeader>

          {selectedList.length > 0 ? (
            <div className="flex flex-col gap-3 border-b bg-primary/5 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                已选择 <strong className="tabular-nums">{selectedList.length}</strong> 名当前页用户
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <form method="post" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="operation" value="set_users" />
                  {selectedList.map((uid) => (
                    <input key={uid} type="hidden" name="uids" value={uid} />
                  ))}
                  <SimpleSelect
                    name="role"
                    defaultValue={roleOptions[0]}
                    className="h-10 min-w-32"
                    ariaLabel="为选中用户设置域角色"
                    options={roleOptions.map((role) => ({ value: role, label: role }))}
                  />
                  <Button type="submit" size="sm" variant="outline" className="h-10" disabled={roleOptions.length === 0}>
                    设置角色
                  </Button>
                </form>
                <Button type="button" size="sm" variant="ghost" className="h-10" onClick={resetViewSelection}>
                  清空选择
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-10"
                  onClick={(event) => openRemoveDialog(selectedRows, event.currentTarget)}
                >
                  <UserMinus className="size-3.5" />
                  移除
                </Button>
              </div>
            </div>
          ) : null}

          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-5">
                    <label className="grid size-10 place-items-center" title="选择当前页全部用户">
                      <Checkbox
                        size="sm"
                        aria-label="选择当前页全部用户"
                        checked={allVisibleSelected}
                        indeterminate={partlyVisibleSelected}
                        disabled={visibleIds.length === 0}
                        onCheckedChange={toggleVisible}
                      />
                    </label>
                  </TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead className="w-28">UID</TableHead>
                  <TableHead className="w-40">域角色</TableHead>
                  <TableHead className="w-28">加入状态</TableHead>
                  <TableHead className="w-20 pr-5 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-40 text-center">
                      <Users className="mx-auto mb-2 size-5 text-muted-foreground" />
                      <p className="text-sm font-medium">{rows.length === 0 ? '当前域还没有成员' : '没有匹配的成员'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {rows.length === 0 ? '添加用户后会显示在这里。' : '请尝试调整搜索词或角色筛选。'}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  roster.items.map((user) => (
                    <TableRow key={user.uid}>
                      <TableCell className="pl-5">
                        <label className="grid size-10 place-items-center">
                          <Checkbox
                            size="sm"
                            aria-label={`选择 ${user.displayName || user.uname || `UID ${user.uid}`}`}
                            checked={selectedUsers.has(user.uid)}
                            disabled={user.uid === ownerUid}
                            onCheckedChange={() => toggleUser(user.uid)}
                          />
                        </label>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-52 items-center gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {(user.displayName || user.uname || user.uid).slice(0, 1).toLocaleUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-sm font-medium" title={user.displayName || user.uname || `UID ${user.uid}`}>
                                {user.displayName || user.uname || `UID ${user.uid}`}
                              </p>
                              {user.uid === ownerUid ? (
                                <Badge variant="outline" className="shrink-0">
                                  域所有者
                                </Badge>
                              ) : null}
                            </div>
                            <p className="truncate text-xs text-muted-foreground" title={user.uname || undefined}>
                              {user.uname ? `@${user.uname}` : '未设置用户名'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{user.uid}</TableCell>
                      <TableCell>
                        <form method="post">
                          <input type="hidden" name="operation" value="set_users" />
                          <input type="hidden" name="uids" value={user.uid} />
                          <RoleQuickSelect
                            defaultValue={user.role}
                            roleOptions={roleOptions}
                            ariaLabel={`修改 ${user.displayName || user.uname || `UID ${user.uid}`} 的域角色`}
                            disabled={user.uid === ownerUid}
                          />
                        </form>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.joined ? 'secondary' : 'outline'}>{user.joined ? '已加入' : '未加入'}</Badge>
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-10 p-0 text-destructive hover:text-destructive"
                          aria-label={`移除 ${user.displayName || user.uname || `UID ${user.uid}`}`}
                          disabled={user.uid === ownerUid}
                          onClick={(event) => openRemoveDialog([user], event.currentTarget)}
                        >
                          <UserMinus className="size-3.5" />
                          <span className="sr-only">移除</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>

          <div className="flex flex-col gap-3 border-t bg-muted/10 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">{roster.total === 0 ? '0 名用户' : `显示 ${roster.start}–${roster.end}，共 ${roster.total} 名`}</p>
            <div className="flex items-center gap-2">
              <span className="min-w-20 text-center text-xs text-muted-foreground">
                第 {roster.page} / {roster.totalPages} 页
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10"
                aria-label="上一页"
                disabled={roster.page <= 1}
                onClick={() => changePage(roster.page - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10"
                aria-label="下一页"
                disabled={roster.page >= roster.totalPages}
                onClick={() => changePage(roster.page + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <AddDomainUsersDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        roleOptions={assignableRoles.length > 0 ? assignableRoles : roleOptions}
        returnFocusRef={addReturnFocusRef}
      />
      <RemoveDomainUsersDialog users={removeUsers} onClose={() => setRemoveUsers([])} returnFocusRef={removeReturnFocusRef} />
    </DomainAdminShell>
  );
}

/* ================================================================== */
/*  Domain Groups                                                      */
/* ================================================================== */

export function DomainGroupPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const groups: R[] = data.groups || [];
  const [groupValues, setGroupValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((group) => [String(group.name), (group.uids || []).join(',')])),
  );
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importText, setImportText] = useState('');
  const selectedGroupList = Array.from(selectedGroups);
  const exportText = groups.map((group) => [group.name, groupValues[group.name] || ''].filter(Boolean).join(',')).join('\n');

  const postGroup = async (operation: 'update' | 'del', name: string, uids = '') => {
    const body = new URLSearchParams({ operation, name });
    if (operation === 'update') body.set('uids', uids);
    const response = await fetch(window.location.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    });
    if (!response.ok) throw new Error(await response.text());
  };

  const toggleGroup = (name: string) => {
    setSelectedGroups((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const saveAllGroups = async () => {
    for (const group of groups) {
      await postGroup('update', String(group.name), groupValues[group.name] || '');
    }
    window.location.reload();
  };

  const importGroups = async (event: React.FormEvent) => {
    event.preventDefault();
    const rows = importText
      .replace(/^\uFEFF/, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, ...uids] = line
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        return { name, uids: uids.join(',') };
      })
      .filter((row) => row.name);
    for (const row of rows) {
      await postGroup('update', row.name, row.uids);
    }
    window.location.reload();
  };

  return (
    <DomainAdminShell title="用户组">
      {/* Create group */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">创建用户组</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="flex items-end gap-2">
            <input type="hidden" name="operation" value="update" />
            <div className="space-y-1 flex-1 max-w-xs">
              <label className="text-xs text-muted-foreground" htmlFor="group-name">
                组名
              </label>
              <Input id="group-name" name="name" placeholder="输入组名" />
            </div>
            <div className="space-y-1 flex-1 max-w-xs">
              <label className="text-xs text-muted-foreground" htmlFor="group-uids">
                用户 UID（逗号分隔）
              </label>
              <Input id="group-uids" name="uids" placeholder="如: 1,2,3" />
            </div>
            <Button type="submit" size="sm" className="gap-1">
              <Plus className="size-3.5" />
              创建
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setShowImport((value) => !value)}>
              <FileUp className="size-3.5" />
              导入
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setShowExport((value) => !value)}>
              <FileDown className="size-3.5" />
              导出
            </Button>
          </div>
        </CardContent>
      </Card>

      {showImport && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">导入用户组</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={importGroups} className="space-y-3">
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={8}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                placeholder="group1,1001,1002&#10;group2,1003,1004"
                required
              />
              <Button type="submit" size="sm" className="gap-1">
                <FileUp className="size-3.5" />
                导入
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {showExport && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">导出用户组</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea value={exportText} readOnly rows={8} className="w-full rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm" />
          </CardContent>
        </Card>
      )}

      {selectedGroupList.length > 0 && (
        <Card className="border-primary/30">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">已选择 {selectedGroupList.length} 个用户组</p>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={async () => {
                if (!window.confirm('确认删除选中的用户组吗？')) return;
                for (const name of selectedGroupList) {
                  await postGroup('del', name);
                }
                window.location.reload();
              }}
            >
              删除选中
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Group list */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">暂无用户组</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5 w-10" />
                  <TableHead>组名</TableHead>
                  <TableHead className="w-24">成员数</TableHead>
                  <TableHead>成员 UID</TableHead>
                  <TableHead className="w-24 text-right pr-5">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.name}>
                    <TableCell className="pl-5">
                      <Checkbox checked={selectedGroups.has(g.name)} onChange={() => toggleGroup(g.name)} />
                    </TableCell>
                    <TableCell className="text-sm font-medium">{g.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {(groupValues[g.name] || '').split(',').filter((uid) => uid.trim()).length}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={groupValues[g.name] || ''}
                        onChange={(event) => setGroupValues({ ...groupValues, [g.name]: event.target.value })}
                        className="font-mono text-xs"
                      />
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <form method="post" className="inline">
                        <input type="hidden" name="operation" value="del" />
                        <input type="hidden" name="name" value={g.name} />
                        <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                          <Trash2 className="mr-1 size-3" />
                          删除
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end border-t p-4">
              <Button type="button" size="sm" className="gap-1" onClick={() => saveAllGroups().catch((error) => alert(error.message))}>
                <Save className="size-3.5" />
                保存全部
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </DomainAdminShell>
  );
}
