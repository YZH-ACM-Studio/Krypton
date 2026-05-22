/**
 * Homework management pages — edit and files.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type PenaltyRuleRow = {
  id: string;
  hours: string;
  coefficient: string;
};

const DEFAULT_PENALTY_RULES: PenaltyRuleRow[] = [
  { id: 'default-1', hours: '1', coefficient: '0.9' },
  { id: 'default-3', hours: '3', coefficient: '0.8' },
  { id: 'default-12', hours: '12', coefficient: '0.75' },
  { id: 'default-9999', hours: '9999', coefficient: '0.5' },
];

function parsePenaltyRules(value: string | null | undefined): PenaltyRuleRow[] {
  if (!value?.trim()) return DEFAULT_PENALTY_RULES;
  const rows = value
    .split('\n')
    .map((line, index) => {
      const match = line.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(?:#.*)?$/);
      if (!match) return null;
      return { id: `rule-${index}-${match[1]}`, hours: match[1], coefficient: match[2] };
    })
    .filter(Boolean) as PenaltyRuleRow[];
  return rows.length ? rows : DEFAULT_PENALTY_RULES;
}

function serializePenaltyRules(rows: PenaltyRuleRow[]) {
  return rows
    .filter((row) => row.hours.trim() && row.coefficient.trim())
    .map((row) => `${row.hours.trim()}: ${row.coefficient.trim()}`)
    .join('\n');
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
  const [penaltyRules, setPenaltyRules] = useState<PenaltyRuleRow[]>(() => parsePenaltyRules(data.penaltyRules));

  const updatePenaltyRule = (id: string, patch: Partial<PenaltyRuleRow>) => {
    setPenaltyRules((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

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
        <h1 className="text-xl font-semibold">{isEdit ? '编辑作业' : '创建作业'}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">作业标题</label>
              <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="beginAtDate" className="text-sm font-medium">开始日期</label>
                <Input id="beginAtDate" name="beginAtDate" type="date" defaultValue={data.dateBeginText || ''} required />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="beginAtTime" className="text-sm font-medium">开始时间</label>
                <Input id="beginAtTime" name="beginAtTime" type="time" defaultValue={data.timeBeginText || ''} required />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="assign" className="text-sm font-medium">分配给</label>
                <Input
                  id="assign"
                  name="assign"
                  defaultValue={(tdoc.assign || []).join?.(',') || tdoc.assign || ''}
                  placeholder="用户组 / UID，逗号分隔"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="maintainer" className="text-sm font-medium">作业维护者</label>
                <Input
                  id="maintainer"
                  name="maintainer"
                  defaultValue={(tdoc.maintainer || []).join?.(',') || tdoc.maintainer || ''}
                  placeholder="UID，逗号分隔"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pids" className="text-sm font-medium">题目列表 (逗号分隔)</label>
              <Input id="pids" name="pids" defaultValue={data.pids || ''} placeholder="P1001,P1002" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="langs" className="text-sm font-medium">提交语言限制</label>
              <Input
                id="langs"
                name="langs"
                defaultValue={(tdoc.langs || []).join?.(',') || tdoc.langs || ''}
                placeholder="cc.cc14,gcc,g++"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="content" className="text-sm font-medium">作业说明 (Markdown)</label>
              <MarkdownEditor name="content" value={tdoc.content || ''} minHeight={280} preferredLang={bs.locale} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-sm font-medium">延期扣分规则</label>
                  <p className="text-xs text-muted-foreground">超过截止时间后，按提交延迟小时数乘以对应分数系数。</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPenaltyRules((rows) => [...rows, { id: `new-${Date.now()}`, hours: '', coefficient: '1' }])}
                >
                  <Plus className="mr-1 size-3" />添加规则
                </Button>
              </div>
              <input type="hidden" name="penaltyRules" value={serializePenaltyRules(penaltyRules)} readOnly />
              <div className="space-y-2">
                {penaltyRules.map((row) => (
                  <div key={row.id} className="grid gap-2 rounded-md border bg-muted/20 p-3 md:grid-cols-[1fr_1fr_auto]">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">延迟达到 (小时)</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        value={row.hours}
                        required
                        onChange={(e) => updatePenaltyRule(row.id, { hours: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">分数系数</label>
                      <Input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={row.coefficient}
                        required
                        onChange={(e) => updatePenaltyRule(row.id, { coefficient: e.target.value })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="self-end text-muted-foreground hover:text-destructive"
                      onClick={() => setPenaltyRules((rows) => (rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows))}
                      aria-label="删除扣分规则"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="rated" value="true" defaultChecked={tdoc.rated}  />
              计入 Rating
            </label>

            <Separator />

            <div className="flex items-center gap-3">
              <Button type="submit" name="operation" value="update">
                <Save className="mr-1 size-4" />{isEdit ? '保存修改' : '创建作业'}
              </Button>
              {isEdit && (
                <Button
                  type="submit"
                  name="operation"
                  value="delete"
                  variant="destructive"
                  size="sm"
                  formNoValidate
                  onClick={(e) => { if (!confirm('确定要删除此作业吗？')) e.preventDefault(); }}
                >
                  <Trash2 className="mr-1 size-3" />删除
                </Button>
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
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="size-4" />文件 ({files.length})
          </CardTitle>
          <form method="post" encType="multipart/form-data" className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
