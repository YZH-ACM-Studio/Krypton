import { motion } from 'motion/react';
import { Activity, Code2, Cpu, HardDrive, LayoutDashboard, MemoryStick, MessageSquare, Power, Server, Trash2, Users, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin/admin-page';
import { useBootstrap } from '@/lib/bootstrap';
import { PERM, PRIV } from '@/lib/perms';
import { formatDateTime } from '@/lib/format';

type R = Record<string, any>;

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function DomainDashboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const domain: R = data.domain || bs.domain;
  const owner: R = data.owner || {};
  const ownerId = owner._id ?? domain.owner;
  const isOwner = String(bs.user.id) === String(ownerId ?? '');

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">域管理</h1>
        </div>
      )}
      bypassPrivGate
    >

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '题目数', value: data.pcount || 0, href: bs.urls.problems },
          { label: '用户数', value: data.ucount || 0, href: '/domain/user' },
          { label: '提交数', value: data.rcount || 0, href: bs.urls.records },
          { label: '讨论数', value: data.dcount || 0, href: bs.urls.discussions },
        ].map((s) => (
          <a key={s.label} href={s.href}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold">{s.value}</p>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">域设置</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: '编辑域信息', href: '/domain/edit' },
              { label: '域用户管理', href: '/domain/user' },
              { label: '权限设置', href: '/domain/permission' },
              { label: '角色管理', href: '/domain/role' },
              { label: '域权限用户组', href: '/domain/group', hint: 'Hydro 自带，按 UID 分组授权' },
              { label: '学生 / 班级 / 学校（用户绑定）', href: '/admin/userbind', hint: 'Krypton 扩展' },
              { label: '反作弊后台', href: '/admin/vigil' },
              { label: '任务系统', href: '/admin/tasks' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span>
                  {link.label}
                  {(link as any).hint && (
                    <span className="ml-2 text-xs text-muted-foreground">({(link as any).hint})</span>
                  )}
                </span>
                <span className="text-muted-foreground">→</span>
              </a>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">域信息</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">域 ID</span>
              <Badge variant="outline">{domain._id || bs.domain.id}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">名称</span>
              <span className="font-medium">{domain.name || bs.domain.name}</span>
            </div>
            {ownerId ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">所有者</span>
                <span className="font-medium">{owner.uname || `UID ${ownerId}`}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-500/30">
        <CardHeader>
          <CardTitle className="text-base">域操作</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form method="post">
            <input type="hidden" name="operation" value="init_discussion_node" />
            <Button type="submit" variant="outline" className="gap-1.5">
              <MessageSquare className="size-4" />
              初始化讨论节点
            </Button>
          </form>
          {isOwner && (
            <form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm('确定要删除此域吗？此操作不可恢复。')) event.preventDefault();
              }}
            >
              <input type="hidden" name="operation" value="delete" />
              <Button type="submit" variant="destructive" className="gap-1.5">
                <Trash2 className="size-4" />
                删除域
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}

export function ManageDashboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data;

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <Wrench className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">系统管理</h1>
        </div>
      )}
      bypassPrivGate
    >

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: '系统设置', desc: '全局配置与参数', href: '/manage/setting', icon: Wrench },
          { label: '系统配置', desc: '配置文件编辑', href: '/manage/config', icon: HardDrive },
          { label: '运行脚本', desc: '执行管理脚本', href: '/manage/script', icon: Activity },
          { label: '导入用户', desc: '批量导入用户', href: '/manage/userimport', icon: Users },
          { label: '用户权限', desc: '管理用户权限', href: '/manage/userpriv', icon: Users },
          { label: '系统状态', desc: '查看系统运行状态', href: bs.urls.status, icon: Server },
        ].map((item) => (
          <a key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-primary/30">
              <CardContent className="flex items-start gap-3 p-4">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <item.icon className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">服务操作</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">重启入口与旧版系统管理页保持一致，仅在 PM2 启动时可用。</p>
          <form
            method="post"
            onSubmit={(event) => {
              if (!window.confirm('确定要重启服务吗？')) event.preventDefault();
            }}
          >
            <input type="hidden" name="operation" value="restart" />
            <Button type="submit" variant="destructive" className="gap-1.5">
              <Power className="size-4" />
              重启服务
            </Button>
          </form>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

export function StatusPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const stats: R[] = data.stats || [];
  const compilers: Array<{ key: string[]; message: string }> = data.compilers || [];
  const languages: Record<string, string> = data.languages || {};
  const onlineCount = stats.filter((s) => s.isOnline).length;
  const totalMemory = stats.reduce((sum, s) => sum + Number(s.memory?.total || 0), 0);
  const usedMemory = stats.reduce((sum, s) => sum + Number(s.memory?.used || 0), 0);

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <Server className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">系统状态</h1>
        </div>
      )}
      bypassPrivGate
    >

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '服务器', value: data.ServerVersion || '—' },
          { label: '数据库', value: data.dbVersion || '—' },
          { label: '在线评测机', value: `${onlineCount}/${stats.length || data.JudgeCount || 0}` },
          { label: '内存使用', value: totalMemory ? `${formatSize(usedMemory)} / ${formatSize(totalMemory)}` : '—' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4" />服务器
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>刷新状态</Button>
        </CardHeader>
        <CardContent className="p-0">
          {stats.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">ID</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>系统</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead className="text-right">内存</TableHead>
                  <TableHead className="pr-5 text-right">请求数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((stat) => (
                  <TableRow key={String(stat._id || stat.mid)}>
                    <TableCell className="pl-5 font-mono text-xs">{String(stat._id || stat.mid || '').slice(0, 8) || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={stat.isOnline ? 'default' : 'outline'} className="text-[10px]">
                        {stat.isOnline ? stat.status || 'Online' : '离线'}
                      </Badge>
                      {!stat.isOnline && stat.updateAt ? (
                        <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(stat.updateAt, bs.locale)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{[stat.osinfo?.distro, stat.osinfo?.release, stat.osinfo?.codename].filter(Boolean).join(' ') || '—'}</div>
                      {stat.osinfo?.arch ? <div className="text-xs text-muted-foreground">{stat.osinfo.arch}</div> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1.5">
                        <Cpu className="size-3.5 text-muted-foreground" />
                        <span>{[stat.cpu?.manufacturer, stat.cpu?.brand].filter(Boolean).join(' ') || '—'}</span>
                      </div>
                      {stat.cpu?.speed ? <div className="text-xs text-muted-foreground">{stat.cpu.speed} GHz</div> : null}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <div className="flex items-center justify-end gap-1.5">
                        <MemoryStick className="size-3.5 text-muted-foreground" />
                        <span>{formatSize(Number(stat.memory?.used || 0))} / {formatSize(Number(stat.memory?.total || 0))}</span>
                      </div>
                      {stat.stack ? <div className="text-xs text-muted-foreground">Stack {stat.stack} MB</div> : null}
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono text-sm">{stat.reqCount ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">暂无服务器状态</p>
          )}
        </CardContent>
      </Card>

      {compilers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Code2 className="size-4" />编译器版本
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {compilers.map((compiler) => (
              <div key={`${compiler.key.join(',')}-${compiler.message}`} className="rounded-md border bg-muted/20 p-3">
                <div className="mb-2 flex flex-wrap gap-1">
                  {compiler.key.map((key) => <Badge key={key} variant="outline" className="text-[10px]">{key}</Badge>)}
                </div>
                <pre className="overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs leading-relaxed text-muted-foreground">{compiler.message}</pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Code2 className="size-4" />编译命令
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Object.keys(languages).length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5 w-56">语言</TableHead>
                  <TableHead className="pr-5">命令</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(languages).map(([lang, command]) => (
                  <TableRow key={lang}>
                    <TableCell className="pl-5 text-sm font-medium">{lang}</TableCell>
                    <TableCell className="pr-5">
                      <code className="break-all rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{command || '—'}</code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">暂无编译命令</p>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
