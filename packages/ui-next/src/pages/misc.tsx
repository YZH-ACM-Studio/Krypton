import { motion } from 'motion/react';
import { ExternalLink, FolderOpen, Globe, HelpCircle, LogOut, Settings, Star, UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatPlainTextSummary } from '@/lib/format';

type R = Record<string, any>;

export function DomainsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const domains: R[] = data.ddocs || data.domains || [];
  const canManage: Record<string, boolean> = data.canManage || {};
  const roles: Record<string, string> = data.role || {};
  const pinnedDomains = new Set((bs.user.pinnedDomains || []).map(String));

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">我的域</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/wiki/help#domain">
              <HelpCircle className="size-4" />
              域帮助
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/domain/join">
              <UserPlus className="size-4" />
              加入域
            </a>
          </Button>
          <Button asChild size="sm">
            <a href="/home/domain/create">创建新域</a>
          </Button>
        </div>
      </div>

      {domains.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="mx-auto size-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">你还没有加入任何域</p>
            <Button asChild variant="outline" className="mt-4">
              <a href="/domain/join">加入域</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((d) => {
            const id = String(d._id);
            const pinned = pinnedDomains.has(id);
            return (
              <Card key={id} className="h-full transition-colors hover:border-primary/30">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">{d.name || id}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">{id}</Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {roles[id] || 'default'}
                        </Badge>
                      </div>
                    </div>
                    <form method="post">
                      <input type="hidden" name="operation" value="star" />
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="star" value={pinned ? 'false' : 'true'} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className={pinned ? 'text-yellow-500' : 'text-muted-foreground'}
                        title={pinned ? '取消置顶' : '置顶'}
                      >
                        <Star className={pinned ? 'size-4 fill-current' : 'size-4'} />
                      </Button>
                    </form>
                  </div>
                  {d.bulletin ? (
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      {formatPlainTextSummary(d.bulletin)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无描述</p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <Button asChild variant="outline" size="sm" className="h-8">
                      <a href={`/d/${id}`}>
                        <ExternalLink className="size-3.5" />
                        访问
                      </a>
                    </Button>
                    {canManage[id] ? (
                      <Button asChild variant="outline" size="sm" className="h-8">
                        <a href={`/d/${id}/domain/dashboard`}>
                          <Settings className="size-3.5" />
                          管理
                        </a>
                      </Button>
                    ) : null}
                    {id !== 'system' && d.owner !== bs.user.id ? (
                      <form method="post" onSubmit={(event) => {
                        if (!window.confirm(`确定离开域 ${id}？`)) event.preventDefault();
                      }}>
                        <input type="hidden" name="operation" value="leave" />
                        <input type="hidden" name="id" value={id} />
                        <Button type="submit" variant="ghost" size="sm" className="h-8 text-destructive">
                          <LogOut className="size-3.5" />
                          退出
                        </Button>
                      </form>
                    ) : null}
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

export function FilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const files: R[] = data.files || [];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <FolderOpen className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">文件管理</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">上传文件</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" encType="multipart/form-data" className="flex items-center gap-3">
            <input type="file" name="file" className="text-sm" />
            <Button type="submit" size="sm">上传</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead className="w-24 text-right">大小</TableHead>
                <TableHead className="w-20 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    暂无文件
                  </TableCell>
                </TableRow>
              ) : (
                files.map((f) => (
                  <TableRow key={String(f.name || f._id)}>
                    <TableCell className="font-medium">{f.name || f.filename}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {f.size ? `${Math.round(f.size / 1024)} KB` : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/file/${bs.user.id}/${f.name || f.filename}`}>下载</a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
}
