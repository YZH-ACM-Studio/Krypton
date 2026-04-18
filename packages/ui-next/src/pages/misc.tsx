import { motion } from 'motion/react';
import { FolderOpen, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';

type R = Record<string, any>;

export function DomainsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const domains: R[] = data.ddocs || data.domains || [];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">我的域</h1>
        </div>
        <Button asChild>
          <a href="/home/domain/create">创建新域</a>
        </Button>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d) => (
            <a key={String(d._id)} href={`/d/${d._id}`}>
              <Card className="h-full transition-colors hover:border-primary/30">
                <CardContent className="p-4">
                  <h3 className="font-medium">{d.name || d._id}</h3>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.bulletin || '暂无描述'}</p>
                  <div className="mt-2">
                    <Badge variant="outline" className="text-[10px]">{d._id}</Badge>
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}
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
