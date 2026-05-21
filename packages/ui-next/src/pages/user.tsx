import { motion } from 'motion/react';
import {
  Calendar,
  Clipboard,
  Mail,
  MessageSquare,
  Shield,
  Settings as SettingsIcon,
  Trophy,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

export function UserDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const udoc: R = data.udoc || {};
  const sdoc: R = data.sdoc || {};
  const pdocs: R[] = data.pdocs || [];
  const tags: Array<[string, number]> = data.tags || [];
  const psdocs: R[] = data.psdocs || [];
  const rdocs: R[] = data.rdocs || [];
  const isSelfProfile = !!data.isSelfProfile || Number(udoc._id) === Number(bs.user.id);

  const name = udoc.uname || 'User';
  const rp = Math.round(Number(udoc.rp || 0));
  const bio = udoc.bio || '';
  const solvedProblems = pdocs.length ? pdocs : psdocs.filter((ps: R) => ps.status === 1);
  const acCount = Number(udoc.nAccept ?? solvedProblems.length ?? 0);
  const submitCount = Number(udoc.nSubmit ?? rdocs.length ?? 0);
  const likedCount = Number(udoc.nLiked ?? udoc.nLike ?? 0);
  const lastActive = sdoc?.updateAt || udoc.loginat;
  const contactItems = [
    ['邮箱', udoc.mail],
    ['QQ', udoc.qq],
    ['微信', udoc.wechat],
  ].filter(([, value]) => value);

  const copyText = async (value: unknown) => {
    if (!value || !navigator.clipboard) return;
    await navigator.clipboard.writeText(String(value));
  };

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:items-start">
          <Avatar className="size-20">
            <AvatarFallback className="text-2xl">{makeInitials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 text-center sm:text-left">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold">{name}</h1>
                {udoc.displayName ? (
                  <p className="text-sm text-muted-foreground">{udoc.displayName}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-end">
                {isSelfProfile ? (
                  <Button asChild variant="outline" size="sm">
                    <a href="/home/settings/account">
                      <SettingsIcon className="size-4" />
                      编辑资料
                    </a>
                  </Button>
                ) : null}
                {bs.user.signedIn && udoc._id ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/home/messages?target=${udoc._id}`} target="_blank" rel="noreferrer">
                      <MessageSquare className="size-4" />
                      发消息
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
            {bio ? (
              <MarkdownView
                content={bio}
                className="mt-2 text-sm text-muted-foreground"
                preferredLang={bs.locale}
              />
            ) : null}
            <div className="mt-3 flex flex-wrap justify-center gap-3 sm:justify-start">
              <Badge variant="secondary">{rp} RP</Badge>
              <Badge variant="outline">{acCount} AC</Badge>
              <Badge variant="outline">{submitCount} 提交</Badge>
              {udoc.rank ? <Badge variant="outline">排名 #{udoc.rank}</Badge> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">UID</p>
            <p className="mt-1 font-mono text-lg font-semibold">{udoc._id ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">注册时间</p>
            <p className="mt-1 text-sm font-medium">{udoc.regat ? formatDateTime(udoc.regat, bs.locale) : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">最近活跃</p>
            <p className="mt-1 text-sm font-medium">{lastActive ? formatDateTime(lastActive, bs.locale) : '离线'}</p>
          </CardContent>
        </Card>
      </div>

      {contactItems.length ? (
        <Card>
          <CardHeader><CardTitle className="text-base">联系方式</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {contactItems.map(([label, value]) => (
              <Button
                key={String(label)}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyText(value)}
              >
                <Clipboard className="size-4" />
                {label}: {String(value)}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
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
                      <span className={r.status === 1 ? 'font-medium text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
                        {r.score ?? '—'}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">已通过题目</CardTitle></CardHeader>
            <CardContent>
              {solvedProblems.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">暂无通过</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {solvedProblems.slice(0, 80).map((pdoc: R) => (
                    <a
                      key={String(pdoc.pid || pdoc.docId || pdoc._id)}
                      href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(pdoc.pid || pdoc.docId) })}
                      className="min-w-0 rounded-md border px-2.5 py-2 text-sm transition-colors hover:bg-accent"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{pdoc.pid || pdoc.docId}</span>
                      <span className="ml-2">{pdoc.title || '已通过题目'}</span>
                    </a>
                  ))}
                  {solvedProblems.length > 80 ? (
                    <span className="px-2 py-1 text-xs text-muted-foreground">另有 {solvedProblems.length - 80} 道</span>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Trophy className="size-4" />统计</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center lg:grid-cols-1">
              {[
                ['提交', submitCount],
                ['通过', acCount],
                ['题解获赞', likedCount],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border bg-muted/20 px-3 py-2">
                  <div className="text-lg font-semibold tabular-nums">{value}</div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {tags.length ? (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Calendar className="size-4" />通过标签</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {tags.map(([tag, count]) => (
                  <div key={tag} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{tag}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
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
                      <Checkbox
                        name={setting.key}
                        defaultChecked={current[setting.key]}
                       />
                      <span className="text-sm">{setting.ui || '启用'}</span>
                    </div>
                  ) : setting.type === 'select' ? (
                    <select
                      name={setting.key}
                      defaultValue={current[setting.key]}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      {(() => {
                        const range = setting.range;
                        if (!range) return null;
                        if (Array.isArray(range)) {
                          // [[value, label], ...] or [value, ...]
                          return range.map((opt: any) => {
                            const val = Array.isArray(opt) ? opt[0] : opt;
                            const label = Array.isArray(opt) ? (opt[1] || opt[0]) : opt;
                            return <option key={String(val)} value={String(val)}>{String(label)}</option>;
                          });
                        }
                        // Record<string, string> — { value: label }
                        return Object.entries(range).map(([val, label]) => (
                          <option key={val} value={val}>{String(label)}</option>
                        ));
                      })()}
                    </select>
                  ) : setting.type === 'markdown' ? (
                    <MarkdownEditor
                      name={setting.key}
                      value={current[setting.key] || ''}
                      minHeight={260}
                    />
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
