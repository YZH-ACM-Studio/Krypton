/**
 * Homework management pages — edit and files.
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

/* ---------- Homework Edit ---------- */

export function HomeworkEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const isEdit = data.page_name === 'homework_edit';
  const hwUrl = isEdit
    ? replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(tdoc.docId || tdoc._id) })
    : bs.urls.homework;

  return (
    <motion.div
      className="mx-auto max-w-2xl space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={hwUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑作业' : '创建作业'}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <input type="hidden" name="operation" value="update" />

            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">作业标题</label>
              <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="beginAtDate" className="text-sm font-medium">开始日期</label>
                <Input id="beginAtDate" name="beginAtDate" type="date" defaultValue={data.dateBeginText || ''} required />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="beginAtTime" className="text-sm font-medium">开始时间</label>
                <Input id="beginAtTime" name="beginAtTime" type="time" defaultValue={data.timeBeginText || ''} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="penaltySinceDate" className="text-sm font-medium">截止日期</label>
                <Input id="penaltySinceDate" name="penaltySinceDate" type="date" defaultValue={data.datePenaltyText || ''} required />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="penaltySinceTime" className="text-sm font-medium">截止时间</label>
                <Input id="penaltySinceTime" name="penaltySinceTime" type="time" defaultValue={data.timePenaltyText || ''} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="extensionDays" className="text-sm font-medium">延期天数</label>
              <Input id="extensionDays" name="extensionDays" type="number" step="0.5" min="0" defaultValue={data.extensionDays || 1} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pids" className="text-sm font-medium">题目列表 (逗号分隔)</label>
              <Input id="pids" name="pids" defaultValue={data.pids || ''} placeholder="P1001,P1002" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="content" className="text-sm font-medium">作业说明 (Markdown)</label>
              <textarea
                id="content"
                name="content"
                rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                defaultValue={tdoc.content || ''}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="penaltyRules" className="text-sm font-medium">罚时规则 (YAML)</label>
              <textarea
                id="penaltyRules"
                name="penaltyRules"
                rows={4}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                defaultValue={data.penaltyRules || ''}
                placeholder="3: 50&#10;5: 30"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="rated" value="true" defaultChecked={tdoc.rated} className="size-4 rounded border" />
              计入 Rating
            </label>

            <Separator />

            <div className="flex items-center gap-3">
              <Button type="submit">
                <Save className="mr-1 size-4" />{isEdit ? '保存修改' : '创建作业'}
              </Button>
              {isEdit && (
                <form method="post" className="inline" onSubmit={(e) => { if (!confirm('确定要删除此作业吗？')) e.preventDefault(); }}>
                  <input type="hidden" name="operation" value="delete" />
                  <Button type="submit" variant="destructive" size="sm">
                    <Trash2 className="mr-1 size-3" />删除
                  </Button>
                </form>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Homework Files ---------- */

export function HomeworkFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const files: R[] = data.files || [];
  const tid = tdoc.docId || tdoc._id;
  const hwUrl = replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(tid) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={hwUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">作业文件</h1>
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
