import { motion } from 'motion/react';
import { ChevronRight, Mail, Shield, Settings as SettingsIcon, User as UserIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

export function UserDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const udoc: R = data.udoc || {};
  const sdoc: R = data.sdoc || {};
  const psdocs: R[] = data.psdocs || [];
  const rdocs: R[] = data.rdocs || [];

  const name = udoc.uname || 'User';
  const rp = Math.round(Number(udoc.rp || 0));
  const bio = udoc.bio || '';
  const acCount = psdocs.filter((ps: R) => ps.status === 1).length;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Profile header */}
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:items-start">
          <Avatar className="size-20">
            <AvatarFallback className="text-2xl">{makeInitials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl font-bold">{name}</h1>
            {bio ? <p className="mt-1 text-sm text-muted-foreground">{bio}</p> : null}
            <div className="mt-3 flex flex-wrap justify-center gap-3 sm:justify-start">
              <Badge variant="secondary">{rp} RP</Badge>
              <Badge variant="outline">{acCount} AC</Badge>
              <Badge variant="outline">{rdocs.length} 提交</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent submissions */}
        <Card>
          <CardHeader><CardTitle className="text-base">最近提交</CardTitle></CardHeader>
          <CardContent>
            {rdocs.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">暂无提交</p>
            ) : (
              <div className="space-y-2">
                {rdocs.slice(0, 10).map((r: R) => (
                  <a
                    key={String(r._id)}
                    href={replaceRouteTokens(bs.urls.recordDetail, { RID: String(r._id) })}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  >
                    <span className="truncate">{r.pid}</span>
                    <span className={r.status === 1 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}>
                      {r.score ?? '—'}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Solved problems */}
        <Card>
          <CardHeader><CardTitle className="text-base">已通过题目</CardTitle></CardHeader>
          <CardContent>
            {acCount === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">暂无通过</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {psdocs
                  .filter((ps: R) => ps.status === 1)
                  .slice(0, 50)
                  .map((ps: R) => (
                    <a
                      key={String(ps.pid || ps.docId)}
                      href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(ps.pid || ps.docId) })}
                      className="rounded border px-1.5 py-0.5 text-xs font-mono text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {ps.pid || ps.docId}
                    </a>
                  ))}
                {acCount > 50 ? (
                  <span className="px-1.5 py-0.5 text-xs text-muted-foreground">+{acCount - 50} more</span>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}

export function SettingsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const settings: R[] = data.settings || [];
  const current: R = data.current || {};

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <SettingsIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">设置</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-6">
            {settings.length > 0 ? (
              settings.map((setting: R) => (
                <div key={setting.key || setting.name} className="space-y-2">
                  <label className="text-sm font-medium">{setting.name || setting.key}</label>
                  {setting.desc ? <p className="text-xs text-muted-foreground">{setting.desc}</p> : null}
                  {setting.type === 'boolean' || setting.type === 'checkbox' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={setting.key}
                        defaultChecked={current[setting.key]}
                        className="size-4 rounded border"
                      />
                      <span className="text-sm">{setting.ui || '启用'}</span>
                    </div>
                  ) : setting.type === 'select' ? (
                    <select
                      name={setting.key}
                      defaultValue={current[setting.key]}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      {(setting.range || []).map((opt: any) => (
                        <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                      ))}
                    </select>
                  ) : setting.type === 'textarea' ? (
                    <textarea
                      name={setting.key}
                      defaultValue={current[setting.key] || ''}
                      rows={3}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  ) : (
                    <Input name={setting.key} defaultValue={current[setting.key] || ''} />
                  )}
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">加载设置项…</p>
            )}
            <Separator />
            <div className="flex justify-end">
              <Button type="submit">保存设置</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function SecurityPage() {
  const bs = useBootstrap();

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <Shield className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">安全设置</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">修改密码</CardTitle></CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <input type="hidden" name="operation" value="password" />
            <div className="space-y-2">
              <label htmlFor="current" className="text-sm font-medium">当前密码</label>
              <Input id="current" name="current" type="password" autoComplete="current-password" />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">新密码</label>
              <Input id="password" name="password" type="password" autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <label htmlFor="verify" className="text-sm font-medium">确认新密码</label>
              <Input id="verify" name="verify" type="password" autoComplete="new-password" />
            </div>
            <Button type="submit">更新密码</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">修改邮箱</CardTitle></CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <input type="hidden" name="operation" value="mail" />
            <div className="space-y-2">
              <label htmlFor="currentPassword" className="text-sm font-medium">当前密码</label>
              <Input id="currentPassword" name="currentPassword" type="password" />
            </div>
            <div className="space-y-2">
              <label htmlFor="mail" className="text-sm font-medium">新邮箱</label>
              <Input id="mail" name="mail" type="email" />
            </div>
            <Button type="submit">更换邮箱</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader><CardTitle className="text-base text-destructive">危险区域</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">删除账号后无法恢复。</p>
          <Button asChild variant="destructive" size="sm" className="mt-3">
            <a href="/user/delete">删除账号</a>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function MessagesPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const messages: R[] = data.messages || [];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <Mail className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">消息</h1>
      </div>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="mx-auto size-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">暂无消息</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {messages.map((m, i) => {
            const sender = bs.udict[String(m.from)] || {};
            return (
              <Card key={i}>
                <CardContent className="flex items-start gap-3 p-4">
                  <Avatar className="mt-0.5 size-8">
                    <AvatarFallback className="text-xs">{makeInitials(sender.uname || '?')}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{sender.uname || '系统消息'}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{m.content || '无内容'}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
