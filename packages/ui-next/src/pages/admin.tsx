import { Activity, Cpu, HardDrive, MemoryStick, MessageSquare, Power, Server, Trash2, Users, Wrench } from 'lucide-react';
import { AdminPage } from '@/components/admin/admin-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Code, Stat, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';

const FOCUS_RING = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

interface DomainDashboardData {
  domain?: { _id?: string; name?: string; owner?: string | number };
  owner?: { _id?: string | number; uname?: string };
  canDeleteDomain?: boolean;
  pcount?: number;
  ucount?: number;
  rcount?: number;
  dcount?: number;
}

interface ServerStatus {
  _id?: string;
  mid?: string;
  isOnline?: boolean;
  status?: string;
  updateAt?: string | Date;
  osinfo?: { distro?: string; release?: string; codename?: string; arch?: string };
  cpu?: { manufacturer?: string; brand?: string; speed?: number };
  memory?: { used?: number; total?: number };
  stack?: number;
  reqCount?: number;
}

interface SystemStatusData {
  ServerVersion?: string;
  dbVersion?: string;
  JudgeCount?: number;
  stats?: ServerStatus[];
  compilers?: Array<{ key: string[]; message: string }>;
  languages?: Record<string, string>;
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function DomainDashboardPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DomainDashboardData;
  const domain: NonNullable<DomainDashboardData['domain']> = data.domain || { _id: bs.domain.id, name: bs.domain.name };
  const owner = data.owner || {};
  const ownerId = owner._id ?? domain.owner;
  const canDeleteDomain = data.canDeleteDomain === true;
  const domainLinks: Array<{ label: string; href: string; hint?: string }> = [
    { label: '编辑域信息', href: '/domain/edit' },
    { label: '入域申请', href: '/domain/join_applications' },
    { label: '域用户管理', href: '/domain/user' },
    { label: '角色与权限', href: bs.urls.domainPermission },
    { label: '域权限用户组', href: '/domain/group', hint: 'Hydro 自带，按 UID 分组授权' },
    { label: '反作弊后台', href: '/admin/vigil' },
    { label: '任务系统', href: '/admin/tasks' },
  ];

  return (
    <AdminPage
      contentClassName="min-w-0"
      title="域管理"
      bypassPrivGate
    >
      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          {[
            { label: '题目数', value: data.pcount || 0, href: bs.urls.problems },
            { label: '用户数', value: data.ucount || 0, href: '/domain/user' },
            { label: '提交数', value: data.rcount || 0, href: bs.urls.records },
            { label: '讨论数', value: data.dcount || 0, href: bs.urls.discussions },
          ].map((item) => (
            <a key={item.label} href={item.href} className={cn('min-w-0 rounded-md hover:bg-surface-hover', FOCUS_RING)}>
              <Stat label={item.label} value={item.value} />
            </a>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="域设置">
          <div className="flex flex-col divide-y divide-line-subtle">
            {domainLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn('flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-md px-2 text-sm hover:bg-surface-hover', FOCUS_RING)}
              >
                <span className="min-w-0 break-words">
                  {link.label}
                  {link.hint ? <span className="ml-2 text-xs text-fg-subtle">({link.hint})</span> : null}
                </span>
                <span className="shrink-0 text-fg-subtle" aria-hidden="true">→</span>
              </a>
            ))}
          </div>
        </Panel>

        <Panel title="域信息">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <dt className="shrink-0 text-fg-subtle">域 ID</dt>
              <dd className="min-w-0">
                <Badge variant="outline" title={String(domain._id || bs.domain.id)} className="max-w-full min-w-0 shrink">
                  <span className="min-w-0 truncate">{domain._id || bs.domain.id}</span>
                </Badge>
              </dd>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <dt className="shrink-0 text-fg-subtle">名称</dt>
              <dd className="min-w-0 truncate text-right font-medium">{domain.name || bs.domain.name}</dd>
            </div>
            {ownerId ? (
              <div className="flex min-w-0 items-center justify-between gap-3">
                <dt className="shrink-0 text-fg-subtle">所有者</dt>
                <dd className="min-w-0 truncate text-right font-medium">{owner.uname || `UID ${ownerId}`}</dd>
              </div>
            ) : null}
          </dl>
        </Panel>
      </div>

      <Panel title="域操作">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form method="post">
            <input type="hidden" name="operation" value="init_discussion_node" />
            <Button type="submit" variant="secondary">
              <MessageSquare />
              初始化讨论节点
            </Button>
          </form>
          {canDeleteDomain ? (
            <form
              method="post"
              onSubmit={(event) => {
                void confirmFormSubmit(event, '确定要删除此域吗？此操作不可恢复。', { destructive: true });
              }}
            >
              <input type="hidden" name="operation" value="delete" />
              <Button type="submit" variant="danger-soft">
                <Trash2 />
                删除域
              </Button>
            </form>
          ) : null}
        </div>
      </Panel>
    </AdminPage>
  );
}

export function ManageDashboardPage() {
  const bs = useBootstrap();

  return (
    <AdminPage
      contentClassName="min-w-0"
      title="系统管理"
      bypassPrivGate
    >
      <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { label: '系统设置', desc: '全局配置与参数', href: '/manage/setting', icon: Wrench },
          { label: '系统配置', desc: '配置文件编辑', href: '/manage/config', icon: HardDrive },
          { label: '运行脚本', desc: '执行管理脚本', href: '/manage/script', icon: Activity },
          { label: '导入用户', desc: '批量导入用户', href: '/manage/userimport', icon: Users },
          { label: '用户权限', desc: '管理用户权限', href: '/manage/userpriv', icon: Users },
          { label: '赛时通过率', desc: '录入/迁移原赛通过数据', href: '/manage/realpass', icon: Activity },
          { label: '兑换码', desc: '创建批次、一次性导出明文并停用或撤销', href: '/manage/redemption-codes', icon: Activity },
          { label: '系统状态', desc: '查看系统运行状态', href: bs.urls.status, icon: Server },
        ].map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={cn('flex min-h-11 w-full min-w-0 items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs hover:bg-surface-hover', FOCUS_RING)}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-fg-subtle">
              <item.icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{item.label}</span>
              <span className="mt-0.5 block text-xs text-pretty text-fg-subtle">{item.desc}</span>
            </span>
          </a>
        ))}
      </div>

      <Panel title="服务操作">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-fg-muted">重启入口与旧版系统管理页保持一致，仅在 PM2 启动时可用。</p>
          <form
            className="shrink-0"
            method="post"
            onSubmit={(event) => {
              void confirmFormSubmit(event, '确定要重启服务吗？', { destructive: true });
            }}
          >
            <input type="hidden" name="operation" value="restart" />
            <Button type="submit" variant="danger-soft">
              <Power />
              重启服务
            </Button>
          </form>
        </div>
      </Panel>
    </AdminPage>
  );
}

export function StatusPage() {
  const bs = useBootstrap();
  const data = bs.page.data as SystemStatusData;
  const stats = data.stats || [];
  const compilers = data.compilers || [];
  const languages = data.languages || {};
  const onlineCount = stats.filter((item) => item.isOnline).length;
  const totalMemory = stats.reduce((sum, item) => sum + Number(item.memory?.total || 0), 0);
  const usedMemory = stats.reduce((sum, item) => sum + Number(item.memory?.used || 0), 0);

  return (
    <AdminPage
      contentClassName="min-w-0"
      title="系统状态"
      bypassPrivGate
    >
      <Panel>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          {[
            { label: '服务器', value: data.ServerVersion || '—' },
            { label: '数据库', value: data.dbVersion || '—' },
            { label: '在线评测机', value: `${onlineCount}/${stats.length || data.JudgeCount || 0}` },
            { label: '内存使用', value: totalMemory ? `${formatSize(usedMemory)} / ${formatSize(totalMemory)}` : '—' },
          ].map((item) => (
            <Stat key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </Panel>

      <Panel
        title="服务器"
        flush
        actions={(
          <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>
            刷新状态
          </Button>
        )}
      >
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
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <StatusDot tone={stat.isOnline ? 'success' : 'neutral'} />
                      {stat.isOnline ? stat.status || 'Online' : '离线'}
                    </span>
                    {!stat.isOnline && stat.updateAt ? (
                      <div className="mt-1 text-xs text-fg-subtle">{formatDateTime(stat.updateAt, bs.locale)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="min-w-0 break-words">{[stat.osinfo?.distro, stat.osinfo?.release, stat.osinfo?.codename].filter(Boolean).join(' ') || '—'}</div>
                    {stat.osinfo?.arch ? <div className="text-xs text-fg-subtle">{stat.osinfo.arch}</div> : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Cpu className="size-3.5 shrink-0 text-fg-subtle" />
                      <span className="min-w-0 break-words">{[stat.cpu?.manufacturer, stat.cpu?.brand].filter(Boolean).join(' ') || '—'}</span>
                    </div>
                    {stat.cpu?.speed ? <div className="text-xs text-fg-subtle">{stat.cpu.speed} GHz</div> : null}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <div className="flex items-center justify-end gap-1.5">
                      <MemoryStick className="size-3.5 shrink-0 text-fg-subtle" />
                      <span className="tabular">
                        {formatSize(Number(stat.memory?.used || 0))} / {formatSize(Number(stat.memory?.total || 0))}
                      </span>
                    </div>
                    {stat.stack ? <div className="text-xs text-fg-subtle">Stack {stat.stack} MB</div> : null}
                  </TableCell>
                  <TableCell className="pr-5 text-right font-mono text-sm tabular">{stat.reqCount ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState compact title="暂无服务器状态" />
        )}
      </Panel>

      {compilers.length > 0 ? (
        <Panel title="编译器版本">
          <div className="flex flex-col gap-3">
            {compilers.map((compiler) => (
              <div key={`${compiler.key.join(',')}-${compiler.message}`} className="rounded-md border border-line bg-surface-sunken p-3">
                <div className="mb-2 flex flex-wrap gap-1">
                  {compiler.key.map((key) => (
                    <Badge key={key} variant="outline" size="sm">
                      {key}
                    </Badge>
                  ))}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-fg">
                  {compiler.message}
                </pre>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="编译命令" flush>
        {Object.keys(languages).length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48 pl-5">语言</TableHead>
                <TableHead className="pr-5">命令</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(languages).map(([lang, command]) => (
                <TableRow key={lang}>
                  <TableCell className="pl-5 text-sm font-medium">{lang}</TableCell>
                  <TableCell className="pr-5">
                    <Code className="break-all">{command || '—'}</Code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState compact title="暂无编译命令" />
        )}
      </Panel>
    </AdminPage>
  );
}
