/**
 * Domain management pages — edit, users, permissions, roles, groups.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Plus,
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

  return (
    <DomainAdminShell title="域用户">
      {/* Search + actions */}
      <div className="flex items-center gap-2">
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
                    <TableHead className="pl-5 w-20">UID</TableHead>
                    <TableHead>用户名</TableHead>
                    <TableHead className="w-32">角色</TableHead>
                    <TableHead className="w-24 text-right pr-5">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roleUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        暂无用户
                      </TableCell>
                    </TableRow>
                  ) : (
                    roleUsers.map((u) => (
                      <TableRow key={u._id}>
                        <TableCell className="pl-5 font-mono text-xs">{u._id}</TableCell>
                        <TableCell className="text-sm font-medium">{u.uname || u.displayName || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{u.role || role}</Badge>
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
                    ))
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
        </CardContent>
      </Card>

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
                  <TableHead className="pl-5">组名</TableHead>
                  <TableHead>成员数</TableHead>
                  <TableHead>成员 UID</TableHead>
                  <TableHead className="w-24 text-right pr-5">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.name}>
                    <TableCell className="pl-5 text-sm font-medium">{g.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {(g.uids || []).length}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate font-mono text-xs text-muted-foreground">
                      {(g.uids || []).join(', ') || '—'}
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
          </CardContent>
        </Card>
      )}
    </DomainAdminShell>
  );
}
