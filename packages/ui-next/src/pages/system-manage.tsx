/**
 * System management pages — settings, config, scripts, user import, user privileges.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  FileCode,
  Key,
  Play,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { AdminPage } from '@/components/admin/admin-page';
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
/*  Shared layout                                                      */
/* ================================================================== */

function ManageShell({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <AdminPage
      bypassPrivGate
      title={(
        <div className="flex items-center gap-2">
          <a
            href="/manage"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </a>
          <Icon className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
      )}
    >
      {children}
    </AdminPage>
  );
}

/* ================================================================== */
/*  System Settings (manage_setting.html)                              */
/* ================================================================== */

export function ManageSettingPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const settings: R[] = data.settings || [];
  const current: R = data.current || {};

  const families = new Map<string, R[]>();
  for (const s of settings) {
    if (s.flag & 1) continue; // FLAG_HIDDEN
    const fam = s.family || 'general';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(s);
  }

  const familyLabels: Record<string, string> = {
    setting_server: '服务器',
    setting_limits: '限制',
    setting_basic: '基本',
    setting_smtp: '邮件 (SMTP)',
    setting_oauth: 'OAuth',
    setting_storage: '存储',
    setting_file: '文件',
    setting_judge: '评测',
    setting_display: '显示',
    setting_usage: '使用',
    general: '通用',
  };

  return (
    <ManageShell title="系统设置" icon={Settings}>
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
              <Button type="submit" className="gap-1">
                <Save className="size-3.5" />
                保存设置
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ManageShell>
  );
}

/* ================================================================== */
/*  System Config (manage_config.html)                                 */
/* ================================================================== */

export function ManageConfigPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const value: string = typeof data.value === 'string' ? data.value : '';

  return (
    <ManageShell title="系统配置" icon={FileCode}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">配置文件（YAML）</CardTitle>
          <p className="text-xs text-muted-foreground">
            直接编辑系统配置，修改后点击保存生效。标记为 [hidden] 的值为敏感信息，不会显示。
          </p>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <textarea
              name="value"
              defaultValue={value}
              rows={24}
              className="w-full resize-y rounded-md border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              spellCheck={false}
            />
            <div className="flex justify-end">
              <Button type="submit" className="gap-1">
                <Save className="size-3.5" />
                保存配置
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </ManageShell>
  );
}

/* ================================================================== */
/*  Run Scripts (manage_script.html)                                   */
/* ================================================================== */

export function ManageScriptPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const scripts: R = data.scripts || {};
  const visibleScripts = Object.entries(scripts).filter(([, script]) => !(script as R).hidden);

  return (
    <ManageShell title="运行脚本" icon={Play}>
      {visibleScripts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            暂无可用脚本
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleScripts.map(([id, script]) => {
            const s = script as R;
            return (
              <Card key={id}>
                <CardContent className="p-4">
                  <form method="post" className="space-y-3">
                    <input type="hidden" name="id" value={id} />
                    <div>
                      <p className="text-sm font-medium">{id}</p>
                      {s.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                      )}
                    </div>
                    {s.validate && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">参数 (JSON)</label>
                        <Input name="args" placeholder='{"key": "value"}' className="font-mono text-xs" />
                      </div>
                    )}
                    <Button type="submit" size="sm" className="gap-1">
                      <Play className="size-3" />
                      运行
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </ManageShell>
  );
}

/* ================================================================== */
/*  User Import (manage_user_import.html)                              */
/* ================================================================== */

export function ManageUserImportPage() {
  const data = useBootstrap().page.data;
  const users: R[] = data.users || [];
  const messages: string[] = data.messages || [];

  return (
    <ManageShell title="导入用户" icon={Upload}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">批量导入</CardTitle>
          <p className="text-xs text-muted-foreground">
            每行一个用户，格式：<code className="rounded bg-muted px-1">邮箱,用户名,密码[,显示名[,额外信息 JSON]]</code>
          </p>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <textarea
              name="users"
              rows={10}
              className="w-full resize-y rounded-md border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="user@example.com,username,password&#10;another@example.com,user2,pass123,DisplayName"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="submit" name="draft" value="true" variant="outline" className="gap-1">
                <Search className="size-3.5" />
                预览
              </Button>
              <Button type="submit" name="draft" value="false" className="gap-1">
                <Upload className="size-3.5" />
                导入
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Messages from import */}
      {messages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">导入日志</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-48 overflow-y-auto rounded border bg-muted/30 p-3">
              {messages.map((msg, i) => (
                <p key={i} className="font-mono text-xs text-muted-foreground">{msg}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Imported users table */}
      {users.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              导入结果
              <Badge variant="secondary" className="ml-2 text-[10px]">{users.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">邮箱</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>密码</TableHead>
                  <TableHead className="pr-5">显示名</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-5 text-xs">{u.email || '—'}</TableCell>
                    <TableCell className="text-sm font-medium">{u.username || '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.password || '—'}</TableCell>
                    <TableCell className="pr-5 text-xs">{u.displayName || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </ManageShell>
  );
}

/* ================================================================== */
/*  User Privileges (manage_user_priv.html)                            */
/* ================================================================== */

const PRIV_LABELS: Record<string, string> = {
  PRIV_EDIT_SYSTEM: '编辑系统设置',
  PRIV_SET_PERM: '设置域权限',
  PRIV_USER_PROFILE: '使用个人资料',
  PRIV_REGISTER_USER: '注册用户',
  PRIV_READ_PROBLEM_DATA: '读取题目数据',
  PRIV_READ_RECORD_CODE: '查看提交代码',
  PRIV_VIEW_HIDDEN_RECORD: '查看隐藏记录',
  PRIV_JUDGE: '评测',
  PRIV_CREATE_DOMAIN: '创建域',
  PRIV_VIEW_ALL_DOMAIN: '查看所有域',
  PRIV_MANAGE_ALL_DOMAIN: '管理所有域',
  PRIV_REJUDGE: '重新评测',
  PRIV_VIEW_USER_SECRET: '查看用户隐私',
  PRIV_VIEW_JUDGE_STATISTICS: '查看评测统计',
  PRIV_UNLIMITED_ACCESS: '无限制访问',
  PRIV_VIEW_SYSTEM_NOTIFICATION: '查看系统通知',
  PRIV_SEND_MESSAGE: '发送消息',
  PRIV_CREATE_FILE: '上传文件',
  PRIV_UNLIMITED_QUOTA: '无限配额',
  PRIV_DELETE_FILE: '删除文件',
  PRIV_MOD_BADGE: '修改徽章',
};

type PrivEntry = {
  key: string;
  bit: bigint;
  label: string;
};

function toPrivBits(value: unknown) {
  try {
    return BigInt(String(value ?? 0));
  } catch {
    return 0n;
  }
}

function getPrivEntries(privEnum: R): PrivEntry[] {
  return Object.entries(privEnum)
    .filter(([, value]) => value != null && /^\d+$/.test(String(value)))
    .map(([key, value]) => ({
      key,
      bit: toPrivBits(value),
      label: PRIV_LABELS[key] || key,
    }))
    .sort((a, b) => (a.bit < b.bit ? -1 : a.bit > b.bit ? 1 : 0));
}

function hasPrivBit(value: bigint, bit: bigint) {
  return (value & bit) !== 0n;
}

function togglePrivBit(value: bigint, bit: bigint, enabled: boolean) {
  const has = hasPrivBit(value, bit);
  if (enabled && !has) return value + bit;
  if (!enabled && has) return value - bit;
  return value;
}

function PrivEditor({
  title,
  description,
  uid,
  system,
  entries,
  initialValue,
  submitLabel,
  onCancel,
}: {
  title: string;
  description?: string;
  uid: string | number;
  system?: boolean;
  entries: PrivEntry[];
  initialValue: unknown;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [bits, setBits] = useState(() => toPrivBits(initialValue));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="size-4" />
          {title}
        </CardTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        <form method="post" className="space-y-4">
          <input type="hidden" name="uid" value={uid} />
          <input type="hidden" name="priv" value={bits.toString()} />
          {system ? <input type="hidden" name="system" value="true" /> : null}
          <div className="rounded-md border bg-muted/20 p-3 font-mono text-xs text-muted-foreground">
            当前权限值：{bits.toString()}
          </div>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {entries.map((entry) => (
              <label key={entry.key} className="inline-flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={hasPrivBit(bits, entry.bit)}
                  onChange={(event) => setBits((value) => togglePrivBit(value, entry.bit, event.currentTarget.checked))}
                  className="size-3.5 rounded border accent-primary"
                />
                <span className="text-muted-foreground">{entry.label}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                取消
              </Button>
            ) : null}
            <Button type="submit" size="sm">
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ManageUserPrivPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const udocs: R[] = data.udocs || [];
  const defaultPriv: number = data.defaultPriv || 0;
  const privEnum: R = data.Priv || {};
  const [search, setSearch] = useState('');
  const [manualUid, setManualUid] = useState('');
  const [manualInitialPriv, setManualInitialPriv] = useState(String(defaultPriv));
  const [editingUser, setEditingUser] = useState<R | null>(null);
  const defaultPrivBits = toPrivBits(defaultPriv);
  const privEntries = getPrivEntries(privEnum);

  const filteredUsers = udocs.filter(
    (u) =>
      !search ||
      (u.uname || '').toLowerCase().includes(search.toLowerCase()) ||
      String(u._id).includes(search),
  );

  const openManualEditor = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const uid = manualUid.trim();
    if (!uid) return;
    setEditingUser({
      _id: uid,
      uname: `UID ${uid}`,
      priv: manualInitialPriv || defaultPriv,
    });
  };

  return (
    <ManageShell title="用户权限" icon={Key}>
      <PrivEditor
        title="默认权限"
        description="新注册用户默认拥有的权限位"
        uid={0}
        system
        entries={privEntries}
        initialValue={defaultPriv}
        submitLabel="保存默认权限"
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="size-4" />
            选择用户
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={openManualEditor} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">UID</label>
              <Input value={manualUid} onChange={(event) => setManualUid(event.target.value)} placeholder="输入 UID" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">起始权限值</label>
              <Input
                value={manualInitialPriv}
                onChange={(event) => setManualInitialPriv(event.target.value)}
                className="font-mono"
                placeholder={defaultPrivBits.toString()}
              />
            </div>
            <Button type="submit" variant="outline">打开编辑器</Button>
          </form>
        </CardContent>
      </Card>

      {editingUser ? (
        <PrivEditor
          key={`${editingUser._id}-${editingUser.priv}`}
          title={`编辑 ${editingUser.uname || `UID ${editingUser._id}`}`}
          uid={editingUser._id}
          entries={privEntries}
          initialValue={editingUser.priv}
          submitLabel="保存用户权限"
          onCancel={() => setEditingUser(null)}
        />
      ) : null}

      {/* User privilege table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserCog className="size-4" />
            用户权限列表
            <Badge variant="secondary" className="text-[10px]">{udocs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="搜索用户…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5 w-20">UID</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>权限值</TableHead>
                <TableHead className="w-28">状态</TableHead>
                <TableHead className="w-32 text-right pr-5">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    {search ? '无匹配用户' : '暂无非默认权限用户'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((u) => {
                  const isBanned = toPrivBits(u.priv) === 0n;
                  return (
                    <TableRow key={u._id}>
                      <TableCell className="pl-5 font-mono text-xs">{u._id}</TableCell>
                      <TableCell className="text-sm font-medium">{u.uname || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {u.priv}
                      </TableCell>
                      <TableCell>
                        {isBanned ? (
                          <Badge variant="destructive" className="text-[10px] gap-0.5">
                            <X className="size-2.5" />
                            已封禁
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-0.5">
                            <Check className="size-2.5" />
                            自定义
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right pr-5">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEditingUser(u)}
                          >
                            编辑
                          </Button>
                          <form method="post">
                            <input type="hidden" name="uid" value={u._id} />
                            {isBanned ? (
                              <>
                                <input type="hidden" name="priv" value={defaultPrivBits.toString()} />
                                <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">
                                  解封
                                </Button>
                              </>
                            ) : (
                              <>
                                <input type="hidden" name="priv" value="0" />
                                <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                                  封禁
                                </Button>
                              </>
                            )}
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </ManageShell>
  );
}

/* ================================================================== */
/*  Shared setting field renderer                                      */
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
        ) : setting.type === 'yaml' || setting.type === 'json' ? (
          <textarea
            name={setting.key}
            defaultValue={typeof value === 'object' ? JSON.stringify(value, null, 2) : (value ?? setting.value ?? '')}
            disabled={isDisabled}
            rows={6}
            className="w-full rounded-md border bg-background p-3 font-mono text-xs disabled:opacity-50"
            spellCheck={false}
          />
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
