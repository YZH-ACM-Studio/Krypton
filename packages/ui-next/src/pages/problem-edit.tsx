/**
 * Problem edit page — form for editing problem title, content, tags,
 * difficulty, visibility, PID, with sidebar navigation and delete.
 */

import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  Save,
  Tag,
  FileText,
  Trash2,
  Flag,
  Send,
  MessageSquare,
  Lightbulb,
  FolderOpen,
  BarChart3,
  Pencil,
  Settings,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { cn } from '@/lib/cn';

type R = Record<string, any>;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const DIFFICULTY_OPTIONS = [
  { value: '', label: '未评定' },
  { value: 1, label: '入门' },
  { value: 2, label: '普及−' },
  { value: 3, label: '普及/提高−' },
  { value: 4, label: '普及+/提高' },
  { value: 5, label: '提高+/省选−' },
  { value: 6, label: '省选/NOI−' },
  { value: 7, label: '省选/NOI' },
  { value: 8, label: 'NOI/NOI+' },
  { value: 9, label: 'NOI+/CTSC' },
  { value: 10, label: 'CTSC/IOI' },
];

/* ---------- Sidebar navigation ---------- */

function ProblemSidebar({ pid, problemUrl, active }: { pid: string; problemUrl: string; active: string }) {
  const nav = [
    { key: 'detail', icon: Flag, label: '查看题目', href: problemUrl },
    { key: 'submit', icon: Send, label: '提交', href: `${problemUrl}/submit` },
    { key: 'solution', icon: Lightbulb, label: '题解', href: `${problemUrl}/solution` },
    { key: 'files', icon: FolderOpen, label: '文件', href: `${problemUrl}/files` },
    { key: 'statistics', icon: BarChart3, label: '统计', href: `${problemUrl}/statistics` },
  ];
  const editNav = [
    { key: 'edit', icon: Pencil, label: '编辑', href: `${problemUrl}/edit` },
    { key: 'config', icon: Settings, label: '评测配置', href: `${problemUrl}/config` },
  ];

  return (
    <nav className="space-y-1">
      {nav.map((item) => (
        <a
          key={item.key}
          href={item.href}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            active === item.key
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <item.icon className="size-4" />
          {item.label}
        </a>
      ))}
      <div className="my-2 border-t" />
      {editNav.map((item) => (
        <a
          key={item.key}
          href={item.href}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            active === item.key
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <item.icon className="size-4" />
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/* ---------- Additional files sidebar section ---------- */

function AdditionalFilesSidebar({ files, problemUrl }: { files: R[]; problemUrl: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">附加文件</h3>
        <a href={`${problemUrl}/files`} className="text-xs text-primary hover:underline">管理</a>
      </div>
      {files.length > 0 ? (
        <div className="space-y-1">
          {files.slice(0, 10).map((f) => (
            <div key={f.name} className="flex items-center justify-between text-xs">
              <span className="truncate font-mono text-muted-foreground" title={f.name}>{f.name}</span>
              <span className="ml-2 shrink-0 text-muted-foreground/60">{formatSize(f.size || 0)}</span>
            </div>
          ))}
          {files.length > 10 && (
            <p className="text-xs text-muted-foreground">+{files.length - 10} 个文件</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">暂无附加文件</p>
      )}
    </div>
  );
}

/* ---------- Main edit page ---------- */

export function ProblemEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};

  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const additionalFiles: R[] = data.additional_file || [];

  const rawContent = pdoc.content || '';
  const contentValue = typeof rawContent === 'string' || (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent))
    ? rawContent
    : String(rawContent || '');

  // Tag input
  const tags: string[] = pdoc.tag || [];
  const [tagInput, setTagInput] = useState(tags.join(', '));

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <a href={bs.urls.problems} className="hover:text-primary">题库</a>
        <ChevronRight className="size-3" />
        <a href={problemUrl} className="font-mono hover:text-primary">{pid}</a>
        <ChevronRight className="size-3" />
        <span>编辑</span>
      </div>

      <div className="flex gap-6">
        {/* Left: main form */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">编辑题目</h1>
          </div>

          <form method="post" className="space-y-4">
            {/* Title + PID row */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-title">标题</label>
                    <Input
                      id="edit-title"
                      name="title"
                      defaultValue={pdoc.title || ''}
                      placeholder="题目标题"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-pid">题目编号</label>
                    <Input
                      id="edit-pid"
                      name="pid"
                      defaultValue={typeof pid === 'string' ? pid : ''}
                      placeholder="如 P1001"
                      pattern="^(?:[a-z0-9]{1,10}-)?[a-zA-Z][a-zA-Z0-9]*$"
                    />
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-tag">
                    <Tag className="mr-1 inline-block size-3.5" />
                    标签
                  </label>
                  <Input
                    id="edit-tag"
                    name="tag"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="用逗号分隔，如：模拟, 数学, 贪心"
                  />
                  {tagInput && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {tagInput.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Difficulty + Hidden */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-difficulty">难度</label>
                    <select
                      id="edit-difficulty"
                      name="difficulty"
                      defaultValue={pdoc.difficulty || ''}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      {DIFFICULTY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <Checkbox
                        name="hidden"
                        defaultChecked={!!pdoc.hidden}
                       />
                      <span className="flex items-center gap-1 text-sm">
                        {pdoc.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        隐藏题目
                      </span>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Content editor */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="size-4" />
                  题面内容
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <MarkdownEditor
                  name="content"
                  value={contentValue}
                  minHeight={400}
                />
              </CardContent>
            </Card>

            {/* Submit / Delete */}
            <div className="flex items-center justify-between">
              <div>
                {!showDeleteConfirm ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    删除题目
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-destructive">确定删除？所有文件、提交和讨论都将被删除。</span>
                    <Button
                      type="submit"
                      name="operation"
                      value="delete"
                      variant="destructive"
                      size="sm"
                    >
                      确认删除
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      取消
                    </Button>
                  </div>
                )}
              </div>
              <Button type="submit" className="gap-1.5">
                <Save className="size-3.5" />
                保存修改
              </Button>
            </div>
          </form>
        </div>

        {/* Right sidebar */}
        <div className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 space-y-6">
            <ProblemSidebar pid={String(pid)} problemUrl={problemUrl} active="edit" />
            <div className="border-t pt-4">
              <AdditionalFilesSidebar files={additionalFiles} problemUrl={problemUrl} />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
