/**
 * Domain management pages — edit, users, permissions, roles, groups.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  FileDown,
  FileUp,
  Plus,
  Save,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor } from '@/components/markdown-renderer';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

type R = Record<string, any>;

/* ================================================================== */
/*  Shared layout for domain admin pages                               */
/* ================================================================== */

function DomainAdminShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center gap-2">
        <a
          href="/domain"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </a>
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
      {children}
    </motion.div>
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
        {setting.desc ? (
          <p className="text-[11px] leading-tight text-muted-foreground">{setting.desc}</p>
        ) : null}
      </div>
      <div>
        {setting.type === 'boolean' || setting.type === 'checkbox' ? (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name={setting.key}
              defaultChecked={!!value}
              disabled={isDisabled}
              className="size-4 rounded border accent-primary"
            />
            <span className="text-sm text-muted-foreground">{setting.ui || '启用'}</span>
          </label>
        ) : setting.type === 'select' ? (
          <select
            name={setting.key}
            defaultValue={value ?? setting.value}
            disabled={isDisabled}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            {renderRange(setting.range)}
          </select>
        ) : setting.type === 'markdown' && !isDisabled ? (
          <MarkdownEditor
            name={setting.key}
            value={value ?? setting.value ?? ''}
            minHeight={260}
          />
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
          <Input
            type="password"
            name={setting.key}
            defaultValue=""
            disabled={isDisabled}
            autoComplete="new-password"
            className="max-w-xs"
          />
        ) : (
          <Input
            name={setting.key}
            defaultValue={value ?? setting.value ?? ''}
            disabled={isDisabled}
            className="max-w-sm"
          />
        )}
      </div>
    </div>
  );
}

function renderRange(range: any) {
  if (!range) return null;
  if (Array.isArray(range)) {
    return range.map((opt: any) => {
      const val = Array.isArray(opt) ? opt[0] : opt;
      const label = Array.isArray(opt) ? (opt[1] || opt[0]) : opt;
      return (
        <option key={String(val)} value={String(val)}>
          {String(label)}
        </option>
      );
    });
  }
  return Object.entries(range).map(([val, label]) => (
    <option key={val} value={val}>
      {String(label)}
    </option>
  ));
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
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {familyLabels[fam] || fam}
                </legend>
                {items.map((setting) => (
                  <SettingField
                    key={setting.key}
                    setting={setting}
                    value={current[setting.key]}
                  />
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

export function DomainUserPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const roles: R[] = data.roles || [];
  const rudocs: R = data.rudocs || {};
  const [search, setSearch] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const roleOptions = roles
    .map((role) => String(role._id || role))
    .filter((role) => role !== 'guest');
  const selectableRoles = roleOptions.filter((role) => role !== 'default');
  const selectedList = Array.from(selectedUsers);

  const toggleUser = (uid: string) => {
    setSelectedUsers((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  return (
    <DomainAdminShell title="域用户">
      {/* Search + actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索用户…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserPlus className="size-4" />
            添加或更新用户
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="grid gap-3 sm:grid-cols-[1fr_180px_auto_auto] sm:items-end">
            <input type="hidden" name="operation" value="set_users" />
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="domain-user-uids">UID（逗号分隔）</label>
              <Input id="domain-user-uids" name="uids" placeholder="1001,1002" required />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="domain-user-role">角色</label>
              <select id="domain-user-role" name="role" className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {(selectableRoles.length ? selectableRoles : roleOptions).map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="join" value="true" className="size-4 rounded border accent-primary" />
              标记已加入
            </label>
            <Button type="submit" size="sm" className="gap-1">
              <UserPlus className="size-3.5" />
              保存
            </Button>
          </form>
        </CardContent>
      </Card>

      {selectedList.length > 0 && (
        <Card className="border-primary/30">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">已选择 {selectedList.length} 个用户</p>
            <div className="flex flex-wrap gap-2">
              <form method="post" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="operation" value="set_users" />
                {selectedList.map((uid) => <input key={uid} type="hidden" name="uids" value={uid} />)}
                <select name="role" className="rounded-md border bg-background px-3 py-2 text-sm">
                  {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  设置角色
                </Button>
              </form>
              <form
                method="post"
                onSubmit={(event) => {
                  if (!window.confirm('确认移除选中的用户吗？')) event.preventDefault();
                }}
              >
                <input type="hidden" name="operation" value="kick" />
                {selectedList.map((uid) => <input key={uid} type="hidden" name="uids" value={uid} />)}
                <Button type="submit" size="sm" variant="destructive">
                  移除用户
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users grouped by role */}
      {Object.entries(rudocs).map(([role, users]) => {
        const roleUsers = (users as R[]).filter(
          (u) =>
            !search ||
            (u.uname || '').toLowerCase().includes(search.toLowerCase()) ||
            String(u._id).includes(search),
        );
        if (roleUsers.length === 0 && search) return null;

        return (
          <Card key={role}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="size-4" />
                {role}
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {(users as R[]).length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5 w-10" />
                    <TableHead className="w-20">UID</TableHead>
                    <TableHead>用户名</TableHead>
                    <TableHead className="w-32">角色</TableHead>
                    <TableHead className="w-24 text-right pr-5">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roleUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        暂无用户
                      </TableCell>
                    </TableRow>
                  ) : (
                    roleUsers.map((u) => {
                      const uid = String(u._id);
                      return (
                        <TableRow key={u._id}>
                        <TableCell className="pl-5">
                          <input
                            type="checkbox"
                            checked={selectedUsers.has(uid)}
                            onChange={() => toggleUser(uid)}
                            className="size-4 rounded border accent-primary"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{u._id}</TableCell>
                        <TableCell className="text-sm font-medium">{u.uname || u.displayName || '—'}</TableCell>
                        <TableCell>
                          <form method="post">
                            <input type="hidden" name="operation" value="set_users" />
                            <input type="hidden" name="uids" value={u._id} />
                            <select
                              name="role"
                              defaultValue={u.role || role}
                              onChange={(event) => event.currentTarget.form?.requestSubmit()}
                              className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                            >
                              {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </form>
                        </TableCell>
                        <TableCell className="text-right pr-5">
                          <form method="post" className="inline">
                            <input type="hidden" name="operation" value="kick" />
                            <input type="hidden" name="uids" value={u._id} />
                            <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                              移除
                            </Button>
                          </form>
                        </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      {Object.keys(rudocs).length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            暂无域用户
          </CardContent>
        </Card>
      )}
    </DomainAdminShell>
  );
}

/* ================================================================== */
/*  Domain Permissions                                                 */
/* ================================================================== */

const FAMILY_LABELS: Record<string, string> = {
  perm_general: '通用',
  perm_problem: '题目',
  perm_record: '记录',
  perm_problem_solution: '题解',
  perm_discussion: '讨论',
  perm_contest: '比赛',
  perm_homework: '作业',
  perm_training: '训练',
  perm_ranking: '排名',
};

export function DomainPermissionPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const roles: R[] = data.roles || [];
  const permsByFamily: R = data.PERMS_BY_FAMILY || {};

  // Filter out built-in 'root' role — it always has all permissions
  const editableRoles = roles.filter((r) => r._id !== 'root');

  return (
    <DomainAdminShell title="权限设置">
      <form method="post">
        {Object.entries(permsByFamily).map(([family, perms]) => {
          const permList = perms as Array<{ key: string; desc: string }>;
          return (
            <Card key={family} className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Shield className="size-4" />
                  {FAMILY_LABELS[family] || family}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5 min-w-[200px]">权限</TableHead>
                      {editableRoles.map((r) => (
                        <TableHead key={r._id} className="text-center min-w-[80px] text-xs">
                          {r._id}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {permList.map((p) => (
                      <TableRow key={String(p.key)}>
                        <TableCell className="pl-5 text-xs">{p.desc}</TableCell>
                        {editableRoles.map((r) => {
                          // BigInt comparison: role.perm & permKey !== 0
                          const rolePerm = BigInt(r.perm || 0);
                          const permKey = BigInt(p.key);
                          const checked = (rolePerm & permKey) !== 0n;
                          return (
                            <TableCell key={r._id} className="text-center">
                              <input
                                type="checkbox"
                                name={`${r._id}`}
                                value={String(p.key)}
                                defaultChecked={checked}
                                className="size-3.5 rounded border accent-primary"
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}

        <div className="flex justify-end">
          <Button type="submit">保存权限</Button>
        </div>
      </form>
    </DomainAdminShell>
  );
}

/* ================================================================== */
/*  Domain Roles                                                       */
/* ================================================================== */

export function DomainRolePage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const roles: R[] = data.roles || [];

  const builtinRoles = ['root', 'default', 'guest'];

  return (
    <DomainAdminShell title="角色管理">
      {/* Add role */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">添加角色</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="flex items-end gap-2">
            <input type="hidden" name="operation" value="add" />
            <div className="space-y-1 flex-1 max-w-xs">
              <label className="text-xs text-muted-foreground" htmlFor="new-role">角色名</label>
              <Input id="new-role" name="role" placeholder="输入角色名" />
            </div>
            <Button type="submit" size="sm" className="gap-1">
              <Plus className="size-3.5" />
              添加
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Existing roles */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">角色名</TableHead>
                <TableHead className="w-24">类型</TableHead>
                <TableHead className="w-24 text-right pr-5">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => {
                const isBuiltin = builtinRoles.includes(r._id);
                return (
                  <TableRow key={r._id}>
                    <TableCell className="pl-5 text-sm font-medium">{r._id}</TableCell>
                    <TableCell>
                      <Badge
                        variant={isBuiltin ? 'secondary' : 'outline'}
                        className="text-[10px]"
                      >
                        {isBuiltin ? '内置' : '自定义'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      {!isBuiltin && (
                        <form method="post" className="inline">
                          <input type="hidden" name="operation" value="delete" />
                          <input type="hidden" name="roles" value={r._id} />
                          <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                            <Trash2 className="mr-1 size-3" />
                            删除
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
  const [groupValues, setGroupValues] = useState<Record<string, string>>(() => Object.fromEntries(
    groups.map((group) => [String(group.name), (group.uids || []).join(',')]),
  ));
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
      // eslint-disable-next-line no-await-in-loop
      await postGroup('update', String(group.name), groupValues[group.name] || '');
    }
    window.location.reload();
  };

  const importGroups = async (event: React.FormEvent) => {
    event.preventDefault();
    const rows = importText.replace(/^\uFEFF/, '').split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, ...uids] = line.split(',').map((item) => item.trim()).filter(Boolean);
        return { name, uids: uids.join(',') };
      })
      .filter((row) => row.name);
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
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
              <label className="text-xs text-muted-foreground" htmlFor="group-name">组名</label>
              <Input id="group-name" name="name" placeholder="输入组名" />
            </div>
            <div className="space-y-1 flex-1 max-w-xs">
              <label className="text-xs text-muted-foreground" htmlFor="group-uids">用户 UID（逗号分隔）</label>
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
            <textarea
              value={exportText}
              readOnly
              rows={8}
              className="w-full rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm"
            />
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
                  // eslint-disable-next-line no-await-in-loop
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
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            暂无用户组
          </CardContent>
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
                      <input
                        type="checkbox"
                        checked={selectedGroups.has(g.name)}
                        onChange={() => toggleGroup(g.name)}
                        className="size-4 rounded border accent-primary"
                      />
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
