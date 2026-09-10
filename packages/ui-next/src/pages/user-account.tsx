/**
 * Unified user account page — settings / security / messages / files
 * displayed in a single layout with tab navigation.
 *
 * Each tab corresponds to a separate server-side URL, so switching tabs
 * triggers a full-page navigation. The active tab is determined by the
 * current templateName from bootstrap.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  FolderOpen,
  Fingerprint,
  Globe,
  Link as LinkIcon,
  LogOut,
  Lock,
  Mail,
  Settings,
  Shield,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { RedeemDialogButton } from '@/components/redeem-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { AvatarUpload } from '@/components/uploader';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { MessagesPanel } from './messages';

export { MessagesPanel } from './messages';

/* ------------------------------------------------------------------ */
/*  Server-doc shapes flowing through the loosely-typed page data      */
/* ------------------------------------------------------------------ */

/** Subset of hydrooj `Setting` consumed by the settings form. */
interface SettingDescriptor {
  key: string;
  name?: string;
  desc?: string;
  family?: string;
  type?: string;
  flag: number;
  ui?: string;
  value?: unknown;
  range?: Array<string | [string, string]> | Record<string, string>;
}

/** JSON-serialized MongoDB `Binary` (WebAuthn credential id). */
interface BinaryIdLike {
  $binary?: { base64?: unknown };
  buffer?: string | { data?: unknown };
  data?: unknown;
}

interface SessionDoc {
  _id: string;
  isCurrent?: boolean;
  updateIp?: string;
  createIp?: string;
  updateUaInfo?: { browser?: { name?: string }; os?: { name?: string } };
}

interface AuthenticatorDoc {
  credentialID?: string | BinaryIdLike;
  name?: string;
  credentialDeviceType?: string;
  fmt?: string;
  regat?: number;
}

interface OauthRelation {
  platform?: string;
  id?: string;
  name?: string;
}

interface LoginMethod {
  id?: string;
  type?: string;
  name?: string;
  text?: string;
}

interface UserFileDoc {
  _id?: string;
  name?: string;
  filename?: string;
  size?: number;
}

interface UserAccountPageData {
  authenticators?: AuthenticatorDoc[];
  category?: string;
  current?: Record<string, unknown> & { avatarUrl?: string | null };
  files?: UserFileDoc[];
  loginMethods?: LoginMethod[];
  messages?: unknown;
  relations?: OauthRelation[];
  sessions?: SessionDoc[];
  settings?: SettingDescriptor[];
}

function binaryIdToBase64(value: string | BinaryIdLike | null | undefined) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.$binary?.base64) return String(value.$binary.base64);
  if (typeof value.buffer === 'string') return value.buffer;
  const data = value.buffer?.data || value.data;
  if (Array.isArray(data)) {
    const bytes = new Uint8Array(data);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
  }
  return String(value.buffer || value);
}

/* ------------------------------------------------------------------ */
/*  Tab definitions                                                    */
/* ------------------------------------------------------------------ */

interface AccountTab {
  id: string;
  label: string;
  icon: React.ElementType;
  href: string;
  templates: string[];
}

function useTabs() {
  const bs = useBootstrap();
  const tabs: AccountTab[] = [
    { id: 'preference', label: '偏好', icon: Settings, href: `${bs.urls.settings}/preference`, templates: [] },
    { id: 'account', label: '账号', icon: UserIcon, href: `${bs.urls.settings}/account`, templates: [] },
    { id: 'domain', label: '域设置', icon: Globe, href: `${bs.urls.settings}/domain`, templates: [] },
    { id: 'security', label: '安全', icon: Shield, href: bs.urls.security, templates: ['home_security.html'] },
    { id: 'messages', label: '消息', icon: Mail, href: bs.urls.messages, templates: ['home_messages.html'] },
    { id: 'files', label: '文件', icon: FolderOpen, href: bs.urls.files, templates: ['home_files.html'] },
  ];
  // Determine active from templateName + data.category
  const tpl = bs.page.templateName;
  const category = (bs.page.data as UserAccountPageData | undefined)?.category;
  let activeId: string;

  if (tpl === 'home_settings.html') {
    activeId = category || 'preference';
  } else {
    activeId = tabs.find((t) => t.templates.includes(tpl))?.id || 'preference';
  }

  return { tabs, activeId };
}

/* ------------------------------------------------------------------ */
/*  Shell — wraps all sub-pages                                        */
/* ------------------------------------------------------------------ */

export function UserAccountPage() {
  const bs = useBootstrap();
  const { tabs, activeId } = useTabs();
  const tpl = bs.page.templateName;
  const isMessages = tpl === 'home_messages.html';

  let content: React.ReactNode;
  if (tpl === 'home_settings.html') content = <SettingsPanel />;
  else if (tpl === 'home_security.html') content = <SecurityPanel />;
  else if (isMessages) content = <MessagesPanel />;
  else if (tpl === 'home_files.html') content = <FilesPanel />;
  else content = <SettingsPanel />;

  return (
    <motion.div
      className={isMessages ? 'flex min-h-0 flex-col gap-2' : 'space-y-4'}
      initial={isMessages ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <h1 className="text-lg font-semibold">{isMessages ? '消息' : '账号设置'}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            href={tab.href}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeId === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
            )}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
            {tab.id === 'messages' && bs.user.unreadMessages > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px]">{bs.user.unreadMessages}</Badge>
            )}
          </a>
        ))}
      </div>

      {/* Panel */}
      {content}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings panel                                                     */
/* ------------------------------------------------------------------ */

function SettingsPanel() {
  const bs = useBootstrap();
  const data = bs.page.data as UserAccountPageData;
  const settings: SettingDescriptor[] = data.settings || [];
  const current: Record<string, unknown> = data.current || {};

  // Group settings by family
  const families = new Map<string, SettingDescriptor[]>();
  for (const s of settings) {
    if (s.flag & 1) continue; // FLAG_HIDDEN
    const fam = s.family || 'general';
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(s);
  }

  const familyLabels: Record<string, string> = {
    setting_display: '显示',
    setting_usage: '使用偏好',
    setting_info: '个人信息',
    setting_customize: '自定义',
    setting_storage: '存储',
    setting_basic: '基本',
    general: '通用',
  };

  return (
    <div className="space-y-4">
      {bs.user.signedIn ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">兑换码</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">用兑换码获取题集或课程访问权益。结果在弹窗里显示。</p>
            <RedeemDialogButton variant="outline" size="default" />
          </CardContent>
        </Card>
      ) : null}
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
              <Button type="submit">保存设置</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingField({ setting, value }: { setting: SettingDescriptor; value: unknown }) {
  const isDisabled = !!(setting.flag & 2); // FLAG_DISABLED
  const isSecret = !!(setting.flag & 4); // FLAG_SECRET
  const bs = useBootstrap();
  const isAvatar = setting.key === 'avatar';

  if (isAvatar) {
    // Replace the plain text field with the full avatar uploader.
    // The text input is still emitted as a hidden input so the form
    // round-trips a non-empty value if the user picks a provider via
    // the popover (the popover hits /home/avatar directly and reloads).
    const data = bs.page.data as { current?: { avatarUrl?: string | null } };
    const current: { avatarUrl?: string | null } = data.current || {};
    const uname = bs.user.name;
    const avatarUrl = current.avatarUrl || null;
    return (
      <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-start">
        <div>
          <label className="text-sm font-medium">{setting.name || setting.key}</label>
          {setting.desc ? <p className="text-[11px] leading-tight text-muted-foreground">{setting.desc}</p> : null}
        </div>
        <div>
          <AvatarUpload uname={uname} currentUrl={avatarUrl || (typeof value === 'string' && /^https?:|^\//.test(value) ? value : null)} size={96} />
          {/* Preserve the existing text value when posting the rest of the form. */}
          <input type="hidden" name={setting.key} value={(value ?? '') as string} readOnly />
        </div>
      </div>
    );
  }

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
          <MarkdownEditor name={setting.key} value={(value ?? setting.value ?? '') as string} minHeight={260} />
        ) : setting.type === 'textarea' || setting.type === 'markdown' ? (
          <textarea
            name={setting.key}
            defaultValue={(value ?? setting.value ?? '') as string}
            disabled={isDisabled}
            rows={setting.type === 'markdown' ? 6 : 3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50"
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
          <Input
            name={setting.key}
            defaultValue={isSecret ? '' : ((value ?? setting.value ?? '') as string)}
            disabled={isDisabled}
            type={isSecret ? 'password' : 'text'}
            className="max-w-sm"
          />
        )}
      </div>
    </div>
  );
}

function rangeOptions(range: SettingDescriptor['range']): { value: string; label: string }[] {
  if (!range) return [];
  if (Array.isArray(range)) {
    return range.map((opt) => {
      const val = Array.isArray(opt) ? opt[0] : opt;
      const label = Array.isArray(opt) ? opt[1] || opt[0] : opt;
      return { value: String(val), label: String(label) };
    });
  }
  // Record<string, string>
  return Object.entries(range).map(([val, label]) => ({
    value: val,
    label: String(label),
  }));
}

/* ------------------------------------------------------------------ */
/*  Security panel                                                     */
/* ------------------------------------------------------------------ */

function SecurityPanel() {
  const bs = useBootstrap();
  const data = bs.page.data as UserAccountPageData;
  const sessions: SessionDoc[] = data.sessions || [];
  const authenticators: AuthenticatorDoc[] = data.authenticators || [];
  const relations: OauthRelation[] = data.relations || [];
  const loginMethods: LoginMethod[] = data.loginMethods || [];
  const linkedPlatforms = new Set(relations.map((relation) => relation.platform));
  const methodsToLink = loginMethods.filter((method) => !linkedPlatforms.has(method.id || method.type));

  return (
    <div className="space-y-4">
      {/* Change username */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserIcon className="size-4" />
            修改用户名
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="change_username" />
            <input type="hidden" name="expectedUsername" value={bs.user.name} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">新用户名</label>
                <Input name="username" defaultValue={bs.user.name} autoComplete="username" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">当前密码</label>
                <Input name="current" type="password" autoComplete="current-password" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">保存后使用新用户名登录；现有登录会话保持不变。</p>
            <Button type="submit" size="sm">
              更新用户名
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Lock className="size-4" />
            修改密码
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="change_password" />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">当前密码</label>
                <Input name="current" type="password" autoComplete="current-password" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">新密码</label>
                <Input name="password" type="password" autoComplete="new-password" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">确认新密码</label>
                <Input name="verifyPassword" type="password" autoComplete="new-password" />
              </div>
            </div>
            <Button type="submit" size="sm">
              更新密码
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Change email */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Mail className="size-4" />
            修改邮箱
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="change_mail" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">当前密码</label>
                <Input name="password" type="password" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">新邮箱</label>
                <Input name="mail" type="email" />
              </div>
            </div>
            <Button type="submit" size="sm">
              更换邮箱
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <LinkIcon className="size-4" />
            关联账号
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bs.user.mail ? (
            <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <span className="text-muted-foreground">邮箱</span>
              <span className="font-medium">{bs.user.mail}</span>
            </div>
          ) : null}
          {relations
            .filter((relation) => relation.platform !== 'mail')
            .map((relation) => (
              <div
                key={`${relation.platform}-${relation.id}`}
                className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{relation.name || relation.platform}</p>
                  <p className="truncate text-xs text-muted-foreground">{relation.id}</p>
                </div>
                <form method="post">
                  <input type="hidden" name="operation" value="unlink_account" />
                  <Button type="submit" name="platform" value={relation.platform} size="sm" variant="outline">
                    解绑
                  </Button>
                </form>
              </div>
            ))}
          {methodsToLink.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {methodsToLink.map((method) => (
                <form key={method.id || method.type} method="post">
                  <input type="hidden" name="operation" value="link_account" />
                  <Button type="submit" name="platform" value={method.id || method.type} size="sm" variant="outline">
                    关联 {method.name || method.text || method.id || method.type}
                  </Button>
                </form>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Fingerprint className="size-4" />
            认证器
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bs.user.tfa && (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">两步验证</p>
                <p className="text-xs text-muted-foreground">TOTP 动态验证码</p>
              </div>
              <form method="post">
                <input type="hidden" name="operation" value="disable_tfa" />
                <Button type="submit" size="sm" variant="outline">
                  移除
                </Button>
              </form>
            </div>
          )}
          {authenticators.map((authenticator) => {
            const id = binaryIdToBase64(authenticator.credentialID);
            return (
              <div key={id || authenticator.name} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{authenticator.name || 'Authenticator'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[authenticator.credentialDeviceType, authenticator.fmt].filter(Boolean).join(' · ') || 'WebAuthn'}
                    {authenticator.regat ? ` · ${formatDateTime(authenticator.regat, bs.locale)}` : ''}
                  </p>
                </div>
                <form method="post">
                  <input type="hidden" name="operation" value="disable_authn" />
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" size="sm" variant="outline">
                    移除
                  </Button>
                </form>
              </div>
            );
          })}
          {!bs.user.tfa && authenticators.length === 0 && <p className="text-sm text-muted-foreground">暂无认证器</p>}
        </CardContent>
      </Card>

      {/* Active sessions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">活跃会话</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">设备</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="text-right pr-5">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                    无活跃会话
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((s) => {
                  const ua: NonNullable<SessionDoc['updateUaInfo']> = s.updateUaInfo || {};
                  const browser = ua.browser?.name || '未知';
                  const os = ua.os?.name || '';
                  return (
                    <TableRow key={s._id}>
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">
                            {browser} {os ? `(${os})` : ''}
                          </span>
                          {s.isCurrent && (
                            <Badge variant="secondary" className="text-[10px]">
                              当前
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{s.updateIp || s.createIp || '—'}</TableCell>
                      <TableCell className="text-right pr-5">
                        {!s.isCurrent && (
                          <form method="post" className="inline">
                            <input type="hidden" name="operation" value="delete_token" />
                            <input type="hidden" name="tokenDigest" value={s._id} />
                            <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                              撤销
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div className="flex justify-end border-t p-4">
            <form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm('确定要注销所有会话吗？当前会话也会退出。')) event.preventDefault();
              }}
            >
              <input type="hidden" name="operation" value="delete_all_tokens" />
              <Button type="submit" size="sm" variant="outline" className="gap-1.5">
                <LogOut className="size-3.5" />
                注销所有会话
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-destructive">危险区域</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">删除账号后所有数据将无法恢复</p>
          <Button asChild variant="destructive" size="sm">
            <a href="/user/delete">删除账号</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Files panel                                                        */
/* ------------------------------------------------------------------ */

function FilesPanel() {
  const bs = useBootstrap();
  const data = bs.page.data as UserAccountPageData;
  const files: UserFileDoc[] = data.files || [];
  const [uploadName, setUploadName] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (name: string) => {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectedList = Array.from(selectedFiles);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">上传文件</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="user-file" className="text-xs text-muted-foreground">
                选择文件
              </label>
              <input
                id="user-file"
                type="file"
                name="file"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) setUploadName(file.name);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="user-filename" className="text-xs text-muted-foreground">
                保存为
              </label>
              <Input
                id="user-filename"
                name="filename"
                value={uploadName}
                onChange={(event) => setUploadName(event.target.value)}
                placeholder="文件名"
                required
              />
            </div>
            <Button type="submit" size="sm" className="gap-1">
              <Upload className="size-3.5" />
              上传
            </Button>
          </form>
        </CardContent>
      </Card>

      {selectedList.length > 0 && (
        <Card className="border-primary/30">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">已选择 {selectedList.length} 个文件</p>
            <form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm('确认删除选中的文件吗？')) event.preventDefault();
              }}
            >
              <input type="hidden" name="operation" value="delete_files" />
              {selectedList.map((name) => (
                <input key={name} type="hidden" name="files" value={name} />
              ))}
              <Button type="submit" size="sm" variant="destructive">
                删除选中
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5 w-10" />
                <TableHead>文件名</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-32 text-center pr-5">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    暂无文件
                  </TableCell>
                </TableRow>
              ) : (
                files.map((f) => {
                  const name = String(f.name || f.filename);
                  return (
                    <TableRow key={String(f.name || f._id)}>
                      <TableCell className="pl-5">
                        <Checkbox checked={selectedFiles.has(name)} onChange={() => toggleFile(name)} />
                      </TableCell>
                      <TableCell className="font-medium text-sm">{f.name || f.filename}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {f.size != null ? formatFileSize(f.size) : '—'}
                      </TableCell>
                      <TableCell className="text-center pr-5">
                        <div className="flex justify-center gap-1">
                          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                            <a href={`/file/${bs.user.id}/${f.name || f.filename}`}>下载</a>
                          </Button>
                          <form method="post" className="inline">
                            <input type="hidden" name="operation" value="delete_files" />
                            <input type="hidden" name="files" value={f.name || f.filename} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-destructive"
                              onClick={(event) => {
                                if (!window.confirm(`确认删除 ${f.name || f.filename}？`)) event.preventDefault();
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
