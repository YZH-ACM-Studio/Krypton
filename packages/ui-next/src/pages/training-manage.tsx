/**
 * Training management pages — edit and files.
 */

import { motion } from 'motion/react';
import {
  ArrowLeft,
  FolderOpen,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------- Training Edit ---------- */

export function TrainingEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const isEdit = data.page_name === 'training_edit';
  const trainingUrl = isEdit
    ? replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tdoc.docId || tdoc._id) })
    : bs.urls.training;

  return (
    <motion.div
      className="mx-auto max-w-2xl space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={trainingUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑训练' : '创建训练'}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">标题</label>
              <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="description" className="text-sm font-medium">简介</label>
              <textarea
                id="description"
                name="description"
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                defaultValue={tdoc.description || ''}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="content" className="text-sm font-medium">详细说明 (Markdown)</label>
              <textarea
                id="content"
                name="content"
                rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                defaultValue={tdoc.content || ''}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="dag" className="text-sm font-medium">训练计划 (DAG JSON)</label>
              <textarea
                id="dag"
                name="dag"
                rows={8}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                defaultValue={data.dag || '[]'}
                placeholder='[{"_id":1,"title":"Level 1","pids":[1001,1002],"requireNids":[]}]'
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pin" className="text-sm font-medium">置顶</label>
              <select id="pin" name="pin" defaultValue={tdoc.pin || 0} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="0">不置顶</option>
                <option value="1">置顶</option>
              </select>
            </div>

            <Separator />

            <div className="flex items-center gap-3">
              <Button type="submit">
                <Save className="mr-1 size-4" />{isEdit ? '保存修改' : '创建训练'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Training Files ---------- */

export function TrainingFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const files: R[] = data.files || [];
  const tid = tdoc.docId || tdoc._id;
  const trainingUrl = replaceRouteTokens(bs.urls.trainingDetail, { TID: String(tid) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={trainingUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">训练文件</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="size-4" />文件 ({files.length})
          </CardTitle>
          <form method="post" encType="multipart/form-data" className="flex items-center gap-2">
            <input type="file" name="file" className="text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="outline">
              <Upload className="mr-1 size-3" />上传
            </Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {files.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead className="w-28 text-right">大小</TableHead>
                  <TableHead className="w-40 text-right">修改时间</TableHead>
                  <TableHead className="w-20 text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-sm">{f.name}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{formatSize(f.size || 0)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {f.lastModified ? formatDateTime(f.lastModified, bs.locale) : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <form method="post" className="inline">
                        <input type="hidden" name="files" value={f.name} />
                        <Button type="submit" name="operation" value="delete_files" variant="ghost" size="icon" className="size-7">
                          <Trash2 className="size-3 text-destructive" />
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">暂无文件</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
