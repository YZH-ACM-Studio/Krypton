/**
 * Domain misc pages — create, join, join applications, contest mode.
 */

import { motion } from 'motion/react';
import {
  ArrowLeft,
  Globe,
  Key,
  Monitor,
  Save,
  Shield,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';

type R = Record<string, any>;

/* ---------- Domain Create ---------- */

export function DomainCreatePage() {
  const bs = useBootstrap();

  return (
    <motion.div
      className="mx-auto max-w-lg space-y-6 pt-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Globe className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">创建域</h1>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="id" className="text-sm font-medium">域 ID</label>
              <Input id="id" name="id" required placeholder="my-domain" pattern="[a-zA-Z][a-zA-Z0-9_-]*" />
              <p className="text-xs text-muted-foreground">只能包含字母、数字、下划线和连字符，以字母开头</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">域名称</label>
              <Input id="name" name="name" required placeholder="我的域" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="bulletin" className="text-sm font-medium">公告 (Markdown)</label>
              <MarkdownEditor name="bulletin" value="" minHeight={220} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="avatar" className="text-sm font-medium">头像 URL (可选)</label>
              <Input id="avatar" name="avatar" placeholder="https://..." />
            </div>

            <Button type="submit" className="w-full">
              <Globe className="mr-1 size-4" />创建域
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Domain Join ---------- */

export function DomainJoinPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const domainInfo: R = data.domainInfo || {};
  const joinSettings: R = data.joinSettings || {};
  const target = data.target || '';
  const redirect = data.redirect || '';
  const code = data.code || '';
  const needCode = joinSettings.method === 2; // JOIN_METHOD_CODE

  return (
    <motion.div
      className="mx-auto max-w-lg space-y-6 pt-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <UserPlus className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">加入域</h1>
        </div>
      </div>

      {domainInfo.name && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium">{domainInfo.name}</h3>
            {domainInfo.bulletin && (
              <div className="mt-3 rounded-md border bg-background/60 p-3">
                <MarkdownView content={domainInfo.bulletin} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <input type="hidden" name="target" value={target} />
            <input type="hidden" name="redirect" value={redirect} />

            {needCode && (
              <div className="space-y-1.5">
                <label htmlFor="code" className="text-sm font-medium">邀请码</label>
                <Input id="code" name="code" defaultValue={code} required placeholder="输入邀请码" />
              </div>
            )}

            <Button type="submit" className="w-full">
              <UserPlus className="mr-1 size-4" />加入
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Domain Join Applications ---------- */

export function DomainJoinApplicationsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const joinSettings: R = data.joinSettings || null;
  const rolesWithText: [string, string][] = data.rolesWithText || [];
  const expirations: Record<string, string> = data.expirations || {};
  const urlPrefix = data.url_prefix || '';

  const METHOD_LABELS: Record<number, string> = {
    0: '禁止加入',
    1: '自由加入',
    2: '需要邀请码',
  };

  return (
    <motion.div
      className="mx-auto max-w-2xl space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">加入设置</h1>
        </div>
      </div>

      {joinSettings && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Badge>{METHOD_LABELS[joinSettings.method] || '未知'}</Badge>
              {joinSettings.role && <Badge variant="outline">角色: {joinSettings.role}</Badge>}
            </div>
            {joinSettings.method === 2 && joinSettings.code && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Key className="size-3.5" />
                <span className="text-muted-foreground">邀请码:</span>
                <code className="font-mono">{joinSettings.code}</code>
              </div>
            )}
            {urlPrefix && (
              <p className="mt-2 text-xs text-muted-foreground">
                加入链接: <code>{urlPrefix}domain/join</code>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">修改加入设置</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="method" className="text-sm font-medium">加入方式</label>
              <select id="method" name="method" defaultValue={joinSettings?.method ?? 0} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="0">禁止加入</option>
                <option value="1">自由加入</option>
                <option value="2">需要邀请码</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="role" className="text-sm font-medium">默认角色</label>
              <select id="role" name="role" defaultValue={joinSettings?.role || 'default'} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {rolesWithText.map(([val, text]) => (
                  <option key={val} value={val}>{text}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="expire" className="text-sm font-medium">有效期</label>
              <select id="expire" name="expire" className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {Object.entries(expirations).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="invitationCode" className="text-sm font-medium">邀请码</label>
              <Input id="invitationCode" name="invitationCode" defaultValue={joinSettings?.code || ''} placeholder="设置邀请码" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="group" className="text-sm font-medium">加入用户组 (可选)</label>
              <Input id="group" name="group" placeholder="组名" />
            </div>

            <Button type="submit"><Save className="mr-1 size-4" />保存</Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Contest Mode ---------- */

export function ContestModePage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const bindings: { _id: number; loginip: string }[] = data.bindings || [];

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Monitor className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">比赛模式</h1>
          </div>
        </div>
        <form method="post" onSubmit={(e) => { if (!confirm('确定要解绑所有用户吗？')) e.preventDefault(); }}>
          <input type="hidden" name="operation" value="reset" />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 className="mr-1 size-3" />全部解绑
          </Button>
        </form>
      </div>

      <p className="text-sm text-muted-foreground">
        比赛模式下，用户将绑定 IP 地址，只能在绑定的设备上登录。共 {bindings.length} 个绑定。
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UID</TableHead>
                <TableHead>IP 地址</TableHead>
                <TableHead className="w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <TableRow key={b._id}>
                  <TableCell className="font-mono text-sm">{b._id}</TableCell>
                  <TableCell className="font-mono text-sm">{b.loginip}</TableCell>
                  <TableCell className="text-center">
                    <form method="post" className="inline">
                      <input type="hidden" name="operation" value="reset" />
                      <input type="hidden" name="uid" value={String(b._id)} />
                      <Button type="submit" variant="ghost" size="icon" className="size-7">
                        <Trash2 className="size-3 text-destructive" />
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {bindings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">暂无 IP 绑定</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}
