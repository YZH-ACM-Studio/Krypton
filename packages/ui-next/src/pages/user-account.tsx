/**
 * Unified user account page — settings / security / messages / files
 * displayed in a single layout with tab navigation.
 *
 * Each tab corresponds to a separate server-side URL, so switching tabs
 * triggers a full-page navigation. The active tab is determined by the
 * current templateName from bootstrap.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  FolderOpen,
  Fingerprint,
  Globe,
  Link as LinkIcon,
  LogOut,
  Lock,
  Mail,
  Quote,
  Send,
  Settings,
  Shield,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AvatarUpload } from '@/components/uploader';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { makeInitials, formatRelativeTime, formatDateTime, replaceRouteTokens } from '@/lib/format';
import { cn } from '@/lib/cn';

type R = Record<string, any>;

function objectIdDate(id: unknown) {
  const value = String(id || '');
  if (!/^[0-9a-f]{24}$/i.test(value)) return null;
  const timestamp = Number.parseInt(value.slice(0, 8), 16) * 1000;
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function parseSystemMessage(content: unknown) {
  if (typeof content !== 'string') return null;
  try {
    const data = JSON.parse(content);
    if (!data || typeof data.message !== 'string') return null;
    return {
      message: data.message as string,
      params: Array.isArray(data.params) ? data.params : [],
    };
  } catch {
    return null;
  }
}

function getMessagePreview(message: R) {
  const system = parseSystemMessage(message.content);
  if (!system) return String(message.content || '');
  return system.message.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const index = Number.parseInt(key.split(':')[0], 10);
    return String(system.params[index] || '');
  });
}

function renderMessageContent(message: R, linkClassName: string) {
  const system = parseSystemMessage(message.content);
  if (!system) return String(message.content || '');
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const regex = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(system.message))) {
    if (match.index > cursor) parts.push(system.message.slice(cursor, match.index));
    const key = match[1];
    const index = Number.parseInt(key.split(':')[0], 10);
    const param = String(system.params[index] || '');
    if (key.endsWith(':link') && param) {
      parts.push(
        <a key={`${match.index}-${key}`} href={param} className={linkClassName} target="_blank" rel="noreferrer">
          {param}
        </a>,
      );
    } else {
      parts.push(<span key={`${match.index}-${key}`} className="font-medium">{param}</span>);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < system.message.length) parts.push(system.message.slice(cursor));
  return parts;
}

function binaryIdToBase64(value: any) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.$binary?.base64) return String(value.$binary.base64);
  if (typeof value.buffer === 'string') return value.buffer;
  const data = value.buffer?.data || value.data;
  if (Array.isArray(data)) {
    const bytes = new Uint8Array(data);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
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
  const category = bs.page.data?.category;
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

  let content: React.ReactNode;
  if (tpl === 'home_settings.html') content = <SettingsPanel />;
  else if (tpl === 'home_security.html') content = <SecurityPanel />;
  else if (tpl === 'home_messages.html') content = <MessagesPanel />;
  else if (tpl === 'home_files.html') content = <FilesPanel />;
  else content = <SettingsPanel />;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <h1 className="text-lg font-semibold">账号设置</h1>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            href={tab.href}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeId === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
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
  const data = bs.page.data;
  const settings: R[] = data.settings || [];
  const current: R = data.current || {};

  // Group settings by family
  const families = new Map<string, R[]>();
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
    <Card>
      <CardContent className="p-5">
        <form method="post" className="space-y-6">
          {Array.from(families.entries()).map(([fam, items]) => (
            <fieldset key={fam} className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {familyLabels[fam] || fam}
              </legend>
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
  );
}

function SettingField({ setting, value }: { setting: R; value: any }) {
  const isDisabled = !!(setting.flag & 2); // FLAG_DISABLED
  const isSecret = !!(setting.flag & 4); // FLAG_SECRET
  const bs = useBootstrap();
  const isAvatar = setting.key === 'avatar';

  if (isAvatar) {
    // Replace the plain text field with the full avatar uploader.
    // The text input is still emitted as a hidden input so the form
    // round-trips a non-empty value if the user picks a provider via
    // the popover (the popover hits /home/avatar directly and reloads).
    const data = bs.page.data as R;
    const current = data.current || {};
    const uname = bs.user.name;
    const avatarUrl = current.avatarUrl || null;
    return (
      <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-start">
        <div>
          <label className="text-sm font-medium">{setting.name || setting.key}</label>
          {setting.desc ? (
            <p className="text-[11px] leading-tight text-muted-foreground">{setting.desc}</p>
          ) : null}
        </div>
        <div>
          <AvatarUpload
            uname={uname}
            currentUrl={avatarUrl || (typeof value === 'string' && /^https?:|^\//.test(value) ? value : null)}
            size={96}
          />
          {/* Preserve the existing text value when posting the rest of the form. */}
          <input type="hidden" name={setting.key} value={value ?? ''} readOnly />
        </div>
      </div>
    );
  }

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
            <Checkbox
              name={setting.key}
              defaultChecked={!!value}
              disabled={isDisabled}
             />
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
            defaultValue={isSecret ? '' : (value ?? setting.value ?? '')}
            disabled={isDisabled}
            type={isSecret ? 'password' : 'text'}
            className="max-w-sm"
          />
        )}
      </div>
    </div>
  );
}

function rangeOptions(range: any): { value: string; label: string }[] {
  if (!range) return [];
  if (Array.isArray(range)) {
    return range.map((opt: any) => {
      const val = Array.isArray(opt) ? opt[0] : opt;
      const label = Array.isArray(opt) ? (opt[1] || opt[0]) : opt;
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
  const data = bs.page.data;
  const sessions: R[] = data.sessions || [];
  const authenticators: R[] = data.authenticators || [];
  const relations: R[] = data.relations || [];
  const loginMethods: R[] = data.loginMethods || [];
  const linkedPlatforms = new Set(relations.map((relation) => relation.platform));
  const methodsToLink = loginMethods.filter((method) => !linkedPlatforms.has(method.id || method.type));

  return (
    <div className="space-y-4">
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
            <Button type="submit" size="sm">更新密码</Button>
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
            <Button type="submit" size="sm">更换邮箱</Button>
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
          {relations.filter((relation) => relation.platform !== 'mail').map((relation) => (
            <div key={`${relation.platform}-${relation.id}`} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
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
                <Button type="submit" size="sm" variant="outline">移除</Button>
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
                  <Button type="submit" size="sm" variant="outline">移除</Button>
                </form>
              </div>
            );
          })}
          {!bs.user.tfa && authenticators.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无认证器</p>
          )}
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
                  const ua = s.updateUaInfo || {};
                  const browser = ua.browser?.name || '未知';
                  const os = ua.os?.name || '';
                  return (
                    <TableRow key={s._id}>
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{browser} {os ? `(${os})` : ''}</span>
                          {s.isCurrent && (
                            <Badge variant="secondary" className="text-[10px]">当前</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {s.updateIp || s.createIp || '—'}
                      </TableCell>
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
/*  Messages panel — data.messages is { [uid]: { udoc, messages[] } }  */
/* ------------------------------------------------------------------ */

type Conv = { uid: number; udoc: R; messages: R[] };

function parseConversations(raw: any): Conv[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const result: Conv[] = [];
  for (const [uid, conv] of Object.entries(raw)) {
    const c = conv as R;
    result.push({
      uid: Number(uid),
      udoc: c.udoc || {},
      messages: Array.isArray(c.messages) ? c.messages : [],
    });
  }
  // Sort by last message time (most recent first).
  result.sort((a, b) => {
    const ta = lastMessageTime(a.messages);
    const tb = lastMessageTime(b.messages);
    return tb - ta;
  });
  return result;
}

function lastMessageTime(messages: R[]): number {
  const last = messages[messages.length - 1];
  if (!last) return 0;
  return objectIdDate(last._id)?.getTime() || 0;
}

/** Hydro `FLAG_UNREAD = 1` — count incoming messages still flagged unread. */
function countUnread(conv: Conv, selfUid: number): number {
  let n = 0;
  for (const m of conv.messages) {
    if (m.from === selfUid) continue;
    if ((m.flag ?? 0) & 1) n += 1;
  }
  return n;
}

function MessagesPanel() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const selfUid = bs.user.id;

  const [conversations, setConversations] = useState<Conv[]>(() => parseConversations(data.messages));
  const [selectedUid, setSelectedUid] = useState<number | null>(conversations[0]?.uid ?? null);
  const [search, setSearch] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [pendingDelete, setPendingDelete] = useState<R | null>(null);
  const [sending, setSending] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  /* Poll /home/messages every 15s for new messages. Hydro doesn't expose
     a dedicated WS endpoint for messages, so polling is the simplest way
     to keep the panel live. We merge by message _id so existing scrolling
     position / drafts aren't disturbed. */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch('/home/messages', { headers: { Accept: 'application/json' }, credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data2 = await res.json();
        if (cancelled) return;
        const fresh = parseConversations(data2.messages);
        // Detect new messages for desktop notification
        let newIncoming = 0;
        const prevIds = new Set<string>();
        for (const c of conversations) for (const m of c.messages) prevIds.add(String(m._id));
        for (const c of fresh) for (const m of c.messages) {
          if (!prevIds.has(String(m._id)) && m.from !== selfUid) newIncoming += 1;
        }
        setConversations(fresh);
        if (newIncoming > 0 && typeof window !== 'undefined' && 'Notification' in window
          && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
          new Notification('Krypton', { body: `${newIncoming} 条新消息` });
        }
      } catch { /* network blips ignored */ }
      finally {
        if (!cancelled) timer = setTimeout(tick, 15000);
      }
    };
    timer = setTimeout(tick, 15000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Ask for notification permission once (best-effort). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, []);

  // Filter conversations by search (uname or message content)
  const filteredConvs = conversations.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    if ((c.udoc.uname || '').toLowerCase().includes(q)) return true;
    return c.messages.some((m) => String(m.content || '').toLowerCase().includes(q));
  });

  const activeConv = conversations.find((c) => c.uid === selectedUid) || null;

  const insertQuote = (m: R) => {
    if (!activeConv) return;
    const uname = activeConv.udoc.uname || `UID ${activeConv.uid}`;
    const body = String(m.content || '').split('\n').map((l) => `> ${l}`).join('\n');
    const quote = `> @${uname} 写道：\n${body}\n\n`;
    setDraftContent((cur) => cur + (cur && !cur.endsWith('\n') ? '\n' : '') + quote);
    requestAnimationFrame(() => draftRef.current?.focus());
  };

  const sendMessage = async () => {
    if (!activeConv) return;
    if (!draftContent.trim() || sending) return;
    setSending(true);
    try {
      const form = new FormData();
      form.append('operation', 'send');
      form.append('uid', String(activeConv.uid));
      form.append('content', draftContent);
      const res = await fetch('/home/messages', {
        method: 'POST', body: form, credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (res.ok || res.redirected) {
        setDraftContent('');
        // Refresh now so we see the just-sent message
        const fr = await fetch('/home/messages', { headers: { Accept: 'application/json' }, credentials: 'include' });
        if (fr.ok) {
          const data3 = await fr.json();
          setConversations(parseConversations(data3.messages));
        }
      }
    } finally { setSending(false); }
  };

  const confirmDelete = async (msg: R) => {
    setPendingDelete(null);
    if (!msg?._id) return;
    const form = new FormData();
    form.append('operation', 'delete_message');
    form.append('messageId', String(msg._id));
    try {
      await fetch('/home/messages', {
        method: 'POST', body: form, credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      // Drop locally
      setConversations((cur) => cur.map((c) => ({
        ...c,
        messages: c.messages.filter((m) => String(m._id) !== String(msg._id)),
      })).filter((c) => c.messages.length > 0));
    } catch { /* ignore */ }
  };

  return (
    <Card className="overflow-hidden">
      {/* Definite height so the thread + composer can flex inside without
          pushing the surrounding Card past the viewport. The grid cells
          inherit this and the message list scrolls internally. */}
      <div className="grid md:grid-cols-[260px_1fr] h-[calc(100vh-220px)] min-h-[480px]">
        {/* Conversation list */}
        <div className="border-r bg-muted/20 flex flex-col min-h-0">
          <div className="p-3 border-b space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">会话</h3>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索用户 / 内容…"
              className="h-8 text-xs"
            />
          </div>
          {filteredConvs.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Mail className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-2 text-xs text-muted-foreground">
                {conversations.length === 0 ? '暂无消息' : '无匹配会话'}
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1" viewportClassName="space-y-0.5 p-1">
              {filteredConvs.map((c) => {
                const name = c.udoc.uname || `UID ${c.uid}`;
                const last = c.messages[c.messages.length - 1];
                const unread = countUnread(c, selfUid);
                return (
                  <button
                    key={c.uid}
                    type="button"
                    onClick={() => setSelectedUid(c.uid)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                      selectedUid === c.uid ? 'bg-accent' : 'hover:bg-accent/50',
                    )}
                  >
                    <Avatar className="size-7 shrink-0">
                      {c.udoc?.avatarUrl ? <AvatarImage src={String(c.udoc.avatarUrl)} alt={name} /> : null}
                      <AvatarFallback className="text-[10px]">{makeInitials(name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <p className="truncate text-sm font-medium">{name}</p>
                        {unread > 0 ? (
                          <Badge className="shrink-0 h-4 min-w-4 px-1 text-[10px]">{unread > 99 ? '99+' : unread}</Badge>
                        ) : null}
                      </div>
                      {last && (
                        <p className="truncate text-[11px] text-muted-foreground">{getMessagePreview(last)}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </ScrollArea>
          )}
        </div>

        {/* Thread + composer — `min-h-0` so the message list (flex-1) can
            actually shrink below its content and scroll internally. */}
        <div className="flex flex-col min-h-0">
          {activeConv ? (
            <>
              <div className="border-b px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="size-7 shrink-0">
                    {activeConv.udoc?.avatarUrl ? <AvatarImage src={String(activeConv.udoc.avatarUrl)} alt={activeConv.udoc.uname || '?'} /> : null}
                    <AvatarFallback className="text-[10px]">{makeInitials(activeConv.udoc.uname || '?')}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{activeConv.udoc.uname || `UID ${activeConv.uid}`}</p>
                    <p className="text-[10px] text-muted-foreground">{activeConv.messages.length} 条消息</p>
                  </div>
                </div>
                <a
                  href={replaceRouteTokens(bs.urls.userDetail, { UID: String(activeConv.uid) })}
                  className="text-xs text-primary hover:underline"
                >
                  资料 →
                </a>
              </div>
              <ScrollArea className="flex-1" viewportClassName="space-y-2 p-4">
                {renderGroupedMessages(activeConv.messages, selfUid, bs.locale, insertQuote, setPendingDelete)}
              </ScrollArea>
              <div className="border-t p-3 space-y-2">
                <textarea
                  ref={draftRef}
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={3}
                  placeholder="输入消息… 支持 Markdown · Ctrl/⌘+Enter 发送"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{draftContent.length} 字符</span>
                  <Button type="button" size="sm" disabled={!draftContent.trim() || sending} onClick={sendMessage}>
                    <Send className="mr-1 size-3.5" />{sending ? '发送中…' : '发送'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">选择一个会话</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="w-full sm:w-[400px]" onClose={() => setPendingDelete(null)}>
          <DialogHeader>
            <DialogTitle>删除消息</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">此操作无法撤销。该消息将从你和对方的会话中移除。</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button variant="destructive" onClick={() => pendingDelete && confirmDelete(pendingDelete)}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Render messages with same-minute grouping (only show timestamp on the
 * first message of each minute-bucket) and per-message quote / delete
 * affordances.
 */
function renderGroupedMessages(
  messages: R[],
  selfUid: number,
  locale: string,
  onQuote: (m: R) => void,
  onAskDelete: (m: R) => void,
) {
  return messages.map((m, i) => {
    const fromMe = m.from === selfUid;
    const time = objectIdDate(m._id);
    const prevTime = i > 0 ? objectIdDate(messages[i - 1]._id) : null;
    const showTime = !prevTime || (time && prevTime && Math.abs(time.getTime() - prevTime.getTime()) > 60_000);
    return (
      <div key={String(m._id) || i} className="space-y-1">
        {showTime && time ? (
          <p className="my-1 text-center text-[10px] text-muted-foreground/70">
            {formatRelativeTime(time, locale)}
          </p>
        ) : null}
        <div className={cn('group flex items-center gap-1.5', fromMe ? 'justify-end' : 'justify-start')}>
          {fromMe ? (
            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" onClick={() => onQuote(m)} title="引用" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Quote className="size-3" />
              </button>
              <button type="button" onClick={() => onAskDelete(m)} title="删除" className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="size-3" />
              </button>
            </div>
          ) : null}
          <div className={cn(
            'max-w-[75%] rounded-lg px-3 py-2 text-sm leading-6',
            fromMe ? 'bg-primary text-primary-foreground' : 'bg-muted',
          )}>
            <div className={cn('break-words whitespace-pre-wrap', fromMe ? '[&_a]:underline' : '')}>
              {renderMessageContent(m, fromMe ? 'font-medium underline underline-offset-2' : 'font-medium text-primary underline underline-offset-2')}
            </div>
          </div>
          {!fromMe ? (
            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" onClick={() => onQuote(m)} title="引用" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Quote className="size-3" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Files panel                                                        */
/* ------------------------------------------------------------------ */

function FilesPanel() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const files: R[] = data.files || [];
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
              <label htmlFor="user-file" className="text-xs text-muted-foreground">选择文件</label>
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
              <label htmlFor="user-filename" className="text-xs text-muted-foreground">保存为</label>
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
              {selectedList.map((name) => <input key={name} type="hidden" name="files" value={name} />)}
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
                      <Checkbox
                        checked={selectedFiles.has(name)}
                        onChange={() => toggleFile(name)}
                       />
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
