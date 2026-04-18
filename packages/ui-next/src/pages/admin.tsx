import { motion } from 'motion/react';
import { Activity, HardDrive, LayoutDashboard, Server, Users, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';

type R = Record<string, any>;

export function DomainDashboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <LayoutDashboard className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">域管理</h1>
      </div>

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
              { label: '用户管理', href: '/domain/user' },
              { label: '权限设置', href: '/domain/permission' },
              { label: '角色管理', href: '/domain/role' },
              { label: '用户组', href: '/domain/group' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span>{link.label}</span>
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
              <Badge variant="outline">{bs.domain.id}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">名称</span>
              <span className="font-medium">{bs.domain.name}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}

export function ManageDashboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <Wrench className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">系统管理</h1>
      </div>

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
    </motion.div>
  );
}

export function StatusPage() {
  const bs = useBootstrap();
  const data = bs.page.data;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <Server className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">系统状态</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '服务器', value: data.ServerVersion || '—' },
          { label: '数据库', value: data.dbVersion || '—' },
          { label: '评测机', value: data.JudgeCount ?? '—' },
          { label: '运行时间', value: data.uptime || '—' },
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
        <CardHeader><CardTitle className="text-base">系统检查</CardTitle></CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>刷新状态</Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
