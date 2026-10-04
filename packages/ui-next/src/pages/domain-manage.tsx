/**
 * Domain management pages — edit, users and groups.
 */

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown, FileUp, Plus, Save, Search, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { alertDialog, confirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { AdminPage } from '@/components/admin/admin-page';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { DomainUserMultiSelect, type DomainUserOption } from '@/components/domain-user-search';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import {
  filterDomainUsers,
  flattenDomainUsers,
  getSelectableDomainUserIds,
  paginateDomainUsers,
  type DomainUserRow,
  type DomainUserSource,
} from '@/lib/domain-user-workspace';

type SettingValue = string | number | boolean | null | undefined;
type SettingRange = Array<string | [string, string]> | Record<string, unknown>;

interface DomainSetting {
  key: string;
  name?: string;
  desc?: string;
  type?: string;
  ui?: string;
  value?: SettingValue;
  flag: number;
  family?: string;
  range?: SettingRange;
}

interface DomainRoleDoc {
  _id?: string | number;
}

interface DomainGroupDoc {
  name: string;
  uids?: (string | number)[];
}

interface DomainManagePageData {
  current?: Record<string, SettingValue>;
  ddoc?: Record<string, SettingValue>;
  domain?: { name?: string; owner?: string | number };
  groups?: DomainGroupDoc[];
  roles?: DomainRoleDoc[];
  rudocs?: Record<string, DomainUserSource[] | undefined>;
  settings?: DomainSetting[];
}

/* ================================================================== */
/*  Settings field renderer (reused from user-account pattern)         */
/* ================================================================== */

function SettingField({ setting, value }: { setting: DomainSetting; value: SettingValue }) {
  const isDisabled = !!(setting.flag & 2);

  return (
    <FormField inline label={setting.name || setting.key} hint={setting.desc || undefined}>
      {setting.type === 'boolean' || setting.type === 'checkbox' ? (
        <label className="inline-flex cursor-pointer items-center gap-2">
          <Switch name={setting.key} defaultChecked={!!value} disabled={isDisabled} />
          <span className="text-sm text-fg-muted">{setting.ui || '启用'}</span>
        </label>
      ) : setting.type === 'select' ? (
        <SimpleSelect
          name={setting.key}
          defaultValue={String(value ?? setting.value ?? '')}
          disabled={isDisabled}
          options={rangeOptions(setting.range)}
        />
      ) : setting.type === 'markdown' && !isDisabled ? (
        <MarkdownEditor name={setting.key} value={(value ?? setting.value ?? '') as string} minHeight={260} />
      ) : setting.type === 'textarea' || setting.type === 'markdown' ? (
        <Textarea
          name={setting.key}
          defaultValue={(value ?? setting.value ?? '') as string | number}
          disabled={isDisabled}
          rows={setting.type === 'markdown' ? 6 : 3}
          className="font-mono"
        />
      ) : setting.type === 'number' || setting.type === 'float' ? (
        <Input
          type="number"
          name={setting.key}
          defaultValue={(value ?? setting.value ?? '') as string | number}
          disabled={isDisabled}
          step={setting.type === 'float' ? 'any' : '1'}
          className="max-w-xs"
        />
      ) : setting.type === 'password' ? (
        <Input type="password" name={setting.key} defaultValue="" disabled={isDisabled} autoComplete="new-password" className="max-w-xs" />
      ) : (
        <Input name={setting.key} defaultValue={(value ?? setting.value ?? '') as string | number} disabled={isDisabled} className="max-w-sm" />
      )}
    </FormField>
  );
}

/**
 * Inline role picker for the user roster — re-submits the surrounding form
 * whenever the user picks a new role. A hidden input named "role" is rendered
 * here so the change handler can find the native form via the input's form
 * property; the SimpleSelect popover lives in a Portal, so
 * event.currentTarget.form won't reach the row.
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

function rangeOptions(range: SettingRange | undefined): { value: string; label: string }[] {
  if (!range) return [];
  if (Array.isArray(range)) {
    return range.map((opt) => {
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
  const data = bs.page.data as DomainManagePageData;
  const current: Record<string, SettingValue> = data.current || {};
  const settings: DomainSetting[] = data.settings || [];

  const families = new Map<string, DomainSetting[]>();
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
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="编辑域">
      <Panel>
        <form method="post" className="flex flex-col gap-6">
          {Array.from(families.entries()).map(([fam, items]) => (
            <fieldset key={fam} className="flex flex-col gap-5">
              <legend className="text-sm font-semibold text-fg">{familyLabels[fam] || fam}</legend>
              {items.map((setting) => (
                <SettingField key={setting.key} setting={setting} value={current[setting.key]} />
              ))}
            </fieldset>
          ))}
          <div className="flex justify-end border-t border-line-subtle pt-4">
            <Button type="submit" variant="primary">保存</Button>
          </div>
        </form>
      </Panel>
    </AdminPage>
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
  domainId,
  roleOptions,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  domainId: string;
  roleOptions: string[];
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const [users, setUsers] = useState<DomainUserOption[]>([]);
  const close = () => {
    setUsers([]);
    onClose();
    restoreDialogTrigger(returnFocusRef);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <form method="post">
        <DialogContent
          size="lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby={ADD_DOMAIN_USERS_DIALOG_TITLE_ID}
          onKeyDown={trapDialogFocus}
        >
          <DialogHeader>
            <DialogTitle id={ADD_DOMAIN_USERS_DIALOG_TITLE_ID}>添加或更新域用户</DialogTitle>
            <p className="mt-1 text-sm text-fg-muted">搜索用户名、UID、学号或姓名，再为这些账号统一设置当前域角色。</p>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-5">
              <input type="hidden" name="operation" value="set_users" />
              <div className="space-y-2" role="group" aria-labelledby="domain-user-uids-label">
                <span id="domain-user-uids-label" className="text-sm font-medium">
                  用户
                </span>
                <DomainUserMultiSelect domainId={domainId} value={users} onChange={setUsers} name="uids" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="domain-user-role">
                  域角色
                </label>
                <SimpleSelect
                  id="domain-user-role"
                  name="role"
                  defaultValue={roleOptions[0]}
                  className="min-w-0"
                  options={roleOptions.map((role) => ({ value: role, label: role }))}
                />
              </div>
              <label className="flex items-start gap-3 rounded-lg border border-line p-3">
                <Checkbox name="join" value="true" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">标记为已加入</span>
                  <span className="mt-0.5 block text-xs text-fg-subtle">同步更新这些用户在当前域中的加入状态。</span>
                </span>
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={roleOptions.length === 0 || users.length === 0}>
              <UserPlus />
              保存用户
            </Button>
          </DialogFooter>
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
          size="md"
          role="dialog"
          aria-modal="true"
          aria-labelledby={REMOVE_DOMAIN_USERS_DIALOG_TITLE_ID}
          onKeyDown={trapDialogFocus}
        >
          <DialogHeader>
            <DialogTitle id={REMOVE_DOMAIN_USERS_DIALOG_TITLE_ID}>确认移除域用户</DialogTitle>
            <p className="mt-1 text-sm text-fg-muted">这会移除所选账号在当前域中的成员身份。</p>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              <input type="hidden" name="operation" value="kick" />
              {users.map((user) => (
                <input key={user.uid} type="hidden" name="uids" value={user.uid} />
              ))}
              <div className="overflow-hidden rounded-lg border border-line">
                {users.slice(0, 8).map((user) => (
                  <div key={user.uid} className="flex items-center justify-between gap-3 border-b border-line-subtle px-3 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <p className="min-w-0 truncate text-sm font-medium" title={user.displayName || user.uname || `UID ${user.uid}`}>
                        {user.displayName || user.uname || `UID ${user.uid}`}
                      </p>
                      <p className="min-w-0 truncate text-xs text-fg-subtle" title={user.uname || undefined}>
                        {user.uname ? `@${user.uname} · ` : ''}
                        UID {user.uid}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">{user.role}</Badge>
                  </div>
                ))}
              </div>
              {users.length > 8 ? <p className="text-xs text-fg-subtle">以及另外 {users.length - 8} 名用户</p> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" autoFocus onClick={close}>
              取消
            </Button>
            <Button type="submit" variant="danger">
              <UserMinus />
              移除 {users.length} 名用户
            </Button>
          </DialogFooter>
        </DialogContent>
      </form>
    </Dialog>
  );
}

export function DomainUserPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DomainManagePageData;
  const roles: DomainRoleDoc[] = data.roles || [];
  const rudocs: Record<string, DomainUserSource[] | undefined> = data.rudocs || {};
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
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="域用户">
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 max-w-prose">
            <h2 className="text-lg font-semibold text-balance">{String(data.domain?.name || bs.domain.name || '当前域')}</h2>
            <p className="mt-1 text-sm text-fg-muted">集中查看成员、加入状态和域角色。</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              <span>
                <strong className="font-semibold tabular">{rows.length}</strong> <span className="text-fg-muted">名成员</span>
              </span>
              <span>
                <strong className="font-semibold tabular">{manageableRoleCount}</strong>{' '}
                <span className="text-fg-muted">个可管理角色</span>
              </span>
              <span>
                <strong className="font-semibold tabular">{filteredRows.length}</strong>{' '}
                <span className="text-fg-muted">条当前结果</span>
              </span>
              <span>
                <strong className="font-semibold tabular">{selectedList.length}</strong> <span className="text-fg-muted">名已选择</span>
              </span>
            </div>
          </div>
          <Button type="button" variant="primary" className="shrink-0" onClick={openAddDialog}>
            <UserPlus />
            添加或更新用户
          </Button>
        </div>
      </Panel>

      <Panel
        flush
        title="成员目录"
        description="搜索展示名、用户名或 UID；角色可直接在表格中修改。"
      >
        <div className="grid gap-2 border-b border-line-subtle px-4 py-3 sm:grid-cols-2">
          <Input
            leading={<Search />}
            aria-label="搜索域用户"
            placeholder="搜索展示名、用户名或 UID"
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
          />
          <SimpleSelect
            value={roleFilter}
            onValueChange={updateRoleFilter}
            ariaLabel="按域角色筛选"
            options={[{ value: '', label: '全部角色' }, ...roleOptions.map((role) => ({ value: role, label: role }))]}
          />
        </div>

        {selectedList.length > 0 ? (
          <div className="flex flex-col gap-3 border-b border-line-subtle bg-brand-soft/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              已选择 <strong className="tabular">{selectedList.length}</strong> 名当前页用户
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
                  className="min-w-32"
                  ariaLabel="为选中用户设置域角色"
                  options={roleOptions.map((role) => ({ value: role, label: role }))}
                />
                <Button type="submit" size="sm" variant="secondary" disabled={roleOptions.length === 0}>
                  设置角色
                </Button>
              </form>
              <Button type="button" size="sm" variant="ghost" onClick={resetViewSelection}>
                清空选择
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger-soft"
                onClick={(event) => openRemoveDialog(selectedRows, event.currentTarget)}
              >
                <UserMinus />
                移除
              </Button>
            </div>
          </div>
        ) : null}

        {roster.items.length === 0 ? (
          <EmptyState
            compact
            icon={<Users />}
            title={rows.length === 0 ? '当前域还没有成员' : '没有匹配的成员'}
            description={rows.length === 0 ? '添加用户后会显示在这里。' : '请尝试调整搜索词或角色筛选。'}
          />
        ) : (
          <>
            <div className="lg:hidden">
              <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-2">
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
                <p className="text-xs text-fg-subtle">选择当前页</p>
              </div>
              <ul className="divide-y divide-line-subtle">
                {roster.items.map((user) => (
                  <li key={user.uid} className="px-4 py-4">
                    <div className="flex items-start gap-3">
                      <label className="grid size-10 shrink-0 place-items-center">
                        <Checkbox
                          size="sm"
                          aria-label={`选择 ${user.displayName || user.uname || `UID ${user.uid}`}`}
                          checked={selectedUsers.has(user.uid)}
                          disabled={user.uid === ownerUid}
                          onCheckedChange={() => toggleUser(user.uid)}
                        />
                      </label>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <p className="min-w-0 truncate text-sm font-medium" title={user.displayName || user.uname || `UID ${user.uid}`}>
                                {user.displayName || user.uname || `UID ${user.uid}`}
                              </p>
                              {user.uid === ownerUid ? (
                                <Badge variant="outline" className="shrink-0">
                                  域所有者
                                </Badge>
                              ) : null}
                            </div>
                            <p className="min-w-0 truncate text-xs text-fg-subtle" title={user.uname || undefined}>
                              {user.uname ? `@${user.uname}` : '未设置用户名'} · UID {user.uid}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="danger-soft"
                            size="sm"
                            iconOnly
                            className="shrink-0"
                            aria-label={`移除 ${user.displayName || user.uname || `UID ${user.uid}`}`}
                            disabled={user.uid === ownerUid}
                            onClick={(event) => openRemoveDialog([user], event.currentTarget)}
                          >
                            <UserMinus />
                            <span className="sr-only">移除</span>
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <form method="post" className="min-w-32 flex-1">
                            <input type="hidden" name="operation" value="set_users" />
                            <input type="hidden" name="uids" value={user.uid} />
                            <RoleQuickSelect
                              defaultValue={user.role}
                              roleOptions={roleOptions}
                              ariaLabel={`修改 ${user.displayName || user.uname || `UID ${user.uid}`} 的域角色`}
                              disabled={user.uid === ownerUid}
                            />
                          </form>
                          <Badge tone={user.joined ? 'success' : 'neutral'} variant={user.joined ? 'soft' : 'outline'}>{user.joined ? '已加入' : '未加入'}</Badge>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
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
                    <TableHead className="w-20 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.items.map((user) => (
                    <TableRow key={user.uid}>
                      <TableCell>
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
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-active text-xs font-semibold text-fg-subtle">
                            {(user.displayName || user.uname || user.uid).slice(0, 1).toLocaleUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="min-w-0 truncate text-sm font-medium" title={user.displayName || user.uname || `UID ${user.uid}`}>
                                {user.displayName || user.uname || `UID ${user.uid}`}
                              </p>
                              {user.uid === ownerUid ? (
                                <Badge variant="outline" className="shrink-0">
                                  域所有者
                                </Badge>
                              ) : null}
                            </div>
                            <p className="min-w-0 truncate text-xs text-fg-subtle" title={user.uname || undefined}>
                              {user.uname ? `@${user.uname}` : '未设置用户名'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular">{user.uid}</TableCell>
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
                        <Badge tone={user.joined ? 'success' : 'neutral'} variant={user.joined ? 'soft' : 'outline'}>{user.joined ? '已加入' : '未加入'}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="danger-soft"
                          size="sm"
                          iconOnly
                          aria-label={`移除 ${user.displayName || user.uname || `UID ${user.uid}`}`}
                          disabled={user.uid === ownerUid}
                          onClick={(event) => openRemoveDialog([user], event.currentTarget)}
                        >
                          <UserMinus />
                          <span className="sr-only">移除</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <div className="flex flex-col gap-3 border-t border-line-subtle bg-surface-sunken px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-fg-muted tabular">{roster.total === 0 ? '0 名用户' : `显示 ${roster.start}–${roster.end}，共 ${roster.total} 名`}</p>
          <div className="flex items-center gap-2">
            <span className="min-w-20 text-center text-xs text-fg-subtle tabular">
              第 {roster.page} / {roster.totalPages} 页
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconOnly
              aria-label="上一页"
              disabled={roster.page <= 1}
              onClick={() => changePage(roster.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconOnly
              aria-label="下一页"
              disabled={roster.page >= roster.totalPages}
              onClick={() => changePage(roster.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Panel>

      <AddDomainUsersDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        domainId={bs.domain.id}
        roleOptions={assignableRoles.length > 0 ? assignableRoles : roleOptions}
        returnFocusRef={addReturnFocusRef}
      />
      <RemoveDomainUsersDialog users={removeUsers} onClose={() => setRemoveUsers([])} returnFocusRef={removeReturnFocusRef} />
    </AdminPage>
  );
}

/* ================================================================== */
/*  Domain Groups                                                      */
/* ================================================================== */

export function DomainGroupPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DomainManagePageData;
  const groups: DomainGroupDoc[] = data.groups || [];
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
    const response = await fetchHydroResponse(window.location.href, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    });
    if (!response.ok) throw new Error(await readHydroResponseError(response, '用户组操作失败'));
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
    <AdminPage bypassPrivGate contentClassName="min-w-0" title="用户组">
      <Panel title="创建用户组">
        <form method="post" className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <input type="hidden" name="operation" value="update" />
          <FormField className="w-full sm:max-w-xs sm:flex-1" label="组名" htmlFor="group-name">
            <Input id="group-name" name="name" placeholder="输入组名" />
          </FormField>
          <FormField className="w-full sm:max-w-xs sm:flex-1" label="用户 UID（逗号分隔）" htmlFor="group-uids">
            <Input id="group-uids" name="uids" placeholder="如: 1,2,3" />
          </FormField>
          <Button type="submit" variant="secondary" className="w-full shrink-0 sm:w-auto">
            <Plus />
            创建
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowImport((value) => !value)}>
            <FileUp />
            导入
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowExport((value) => !value)}>
            <FileDown />
            导出
          </Button>
        </div>
      </Panel>

      {showImport && (
        <Panel title="导入用户组">
          <form onSubmit={importGroups} className="flex flex-col gap-3">
            <Textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={8}
              className="font-mono"
              placeholder="group1,1001,1002&#10;group2,1003,1004"
              required
            />
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" size="sm">
                <FileUp />
                导入
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {showExport && (
        <Panel title="导出用户组">
          <Textarea value={exportText} readOnly rows={8} className="font-mono" />
        </Panel>
      )}

      {selectedGroupList.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg-muted">已选择 {selectedGroupList.length} 个用户组</p>
          <Button
            type="button"
            size="sm"
            variant="danger-soft"
            onClick={async () => {
              if (!(await confirmDialog('确认删除选中的用户组吗？', { destructive: true }))) return;
              for (const name of selectedGroupList) {
                await postGroup('del', name);
              }
              window.location.reload();
            }}
          >
            删除选中
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState title="暂无用户组" />
      ) : (
        <Panel
          flush
          footer={(
            <div className="flex justify-end">
              <Button type="button" variant="primary" size="sm" onClick={() => saveAllGroups().catch((error) => { void alertDialog(error instanceof Error ? error.message : String(error)); })}>
                <Save />
                保存全部
              </Button>
            </div>
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>组名</TableHead>
                <TableHead className="w-24">成员数</TableHead>
                <TableHead>成员 UID</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.name}>
                  <TableCell>
                    <Checkbox checked={selectedGroups.has(g.name)} onChange={() => toggleGroup(g.name)} />
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="block max-w-48 min-w-0 truncate" title={g.name}>{g.name}</span>
                  </TableCell>
                  <TableCell>
                    <Badge size="sm">
                      {(groupValues[g.name] || '').split(',').filter((uid) => uid.trim()).length}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={groupValues[g.name] || ''}
                      onChange={(event) => setGroupValues({ ...groupValues, [g.name]: event.target.value })}
                      className="font-mono"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <form method="post" className="inline">
                      <input type="hidden" name="operation" value="del" />
                      <input type="hidden" name="name" value={g.name} />
                      <Button type="submit" variant="danger-soft" size="sm">
                        <Trash2 />
                        删除
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </AdminPage>
  );
}
