/**
 * Problem edit page — form for editing problem title, content, tags,
 * difficulty, visibility, and PID.
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs-compound';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

const DIFFICULTY_OPTIONS = [
  { value: 0, label: '未评定' },
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

export function ProblemEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const statementLangs: R = data.statementLangs || {};

  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  // Resolve initial content — may be multilingual object or plain string
  const rawContent = pdoc.content || '';
  const isMultiLang = typeof rawContent === 'object' && rawContent !== null;
  const contentLangs = isMultiLang ? Object.keys(rawContent) : [];
  const defaultLang = contentLangs.length > 0
    ? (contentLangs.find((l) => l.startsWith('zh')) || contentLangs[0])
    : '';
  const [editLang, setEditLang] = useState(defaultLang);

  const initialContent = isMultiLang
    ? (rawContent[editLang] || rawContent[contentLangs[0]] || '')
    : String(rawContent);

  const [content, setContent] = useState(initialContent);
  const [previewMode, setPreviewMode] = useState(false);

  // Tag input
  const tags: string[] = pdoc.tag || [];
  const [tagInput, setTagInput] = useState(tags.join(', '));

  const handleLangSwitch = useCallback((lang: string) => {
    setEditLang(lang);
    if (isMultiLang) {
      setContent(rawContent[lang] || '');
    }
  }, [isMultiLang, rawContent]);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <a href={bs.urls.problems} className="hover:text-primary">题库</a>
        <ChevronRight className="size-3" />
        <a href={problemUrl} className="font-mono hover:text-primary">{pid}</a>
        <ChevronRight className="size-3" />
        <span>编辑</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">编辑题目</h1>
        <Button asChild variant="ghost" size="sm">
          <a href={problemUrl}>返回题目</a>
        </Button>
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
                  defaultValue={pdoc.difficulty || 0}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    name="hidden"
                    defaultChecked={!!pdoc.hidden}
                    className="size-4 rounded border accent-primary"
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
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="size-4" />
                题面内容
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* Language tabs for multilingual content */}
                {isMultiLang && contentLangs.length > 1 && (
                  <div className="flex gap-1">
                    {contentLangs.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => handleLangSwitch(lang)}
                        className={`rounded px-2 py-0.5 text-xs transition-colors ${
                          editLang === lang
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewMode((p) => !p)}
                  className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {previewMode ? '编辑' : '预览'}
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {previewMode ? (
              <div className="min-h-[300px] border-t p-4 sm:p-6">
                <MarkdownView content={content} />
              </div>
            ) : (
              <textarea
                name="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={20}
                className="w-full resize-y border-t bg-background p-4 font-mono text-sm focus:outline-none"
                placeholder="请输入 Markdown 格式的题面内容…"
              />
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            支持 Markdown 格式，包括 LaTeX 数学公式
          </p>
          <Button type="submit" className="gap-1.5">
            <Save className="size-3.5" />
            保存修改
          </Button>
        </div>
      </form>
    </motion.div>
  );
}
