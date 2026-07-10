/**
 * 出卷中心 · 客观题独立编辑器（Rev.12）。
 *
 * 路由 /paper-center/:docId/edit（handler/paper-center.ts PaperCenterEditHandler，
 * owner/教师 gated）。页面数据直接带 raw config（不再 fetch 文件下载路由——
 * 那条路对缺失文件不返回 404，是"config 加载失败"bug 的根因）。
 *
 * 保存只发结构化 questions JSON，canonical config YAML 由服务端生成与校验。
 * 布局（grill Q7 锁定）：吸顶栏（标题/隐藏/标签/总分/保存）+ 左（折叠卷首
 * 说明 + 小题列表 + 按题型添加）+ 右（吸顶实时预览）。
 */
import {
  ArrowLeft, ChevronDown, ChevronRight, Loader2, NotebookPen, Save,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';
import {
  ObjectiveEditor, ObjectivePreview, type ObjectiveQuestion, parseConfigYaml,
} from '@/pages/problem-type-editor';

type R = Record<string, any>;

export function PaperCenterEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as { pdoc: R, configRaw: string };
  const pdoc = data.pdoc || {};

  const [title, setTitle] = useState<string>(pdoc.title || '');
  const [hidden, setHidden] = useState<boolean>(!!pdoc.hidden);
  const [tagInput, setTagInput] = useState<string>((pdoc.tag || []).join(', '));
  const [content, setContent] = useState<string>(pdoc.content || '');
  const [showContent, setShowContent] = useState<boolean>(!!(pdoc.content || '').trim());
  const [questions, setQuestions] = useState<ObjectiveQuestion[]>(
    () => parseConfigYaml(data.configRaw || '').objective,
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err', text: string } | null>(null);

  const totalScore = useMemo(() => questions.reduce((s, q) => s + (Number(q.score) || 0), 0), [questions]);

  const save = async () => {
    if (!title.trim()) {
      setMsg({ kind: 'err', text: '标题不能为空' });
      return;
    }
    if (!questions.length) {
      setMsg({ kind: 'err', text: '至少添加一道小题' });
      return;
    }
    const seen = new Set<string>();
    for (const q of questions) {
      if (!q.key.trim()) {
        setMsg({ kind: 'err', text: '存在空题号，请补全' });
        return;
      }
      if (seen.has(q.key)) {
        setMsg({ kind: 'err', text: `题号 "${q.key}" 重复` });
        return;
      }
      seen.add(q.key);
    }
    setSaving(true);
    setMsg(null);
    try {
      const tags = tagInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      const form = new FormData();
      form.append('title', title.trim());
      form.append('content', content);
      form.append('tag', JSON.stringify(tags));
      form.append('hidden', hidden ? 'true' : 'false');
      form.append('questions', JSON.stringify(questions));
      const res = await fetch(window.location.pathname, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.error) throw new Error(body?.error?.message || `保存失败（HTTP ${res.status}）`);
      setMsg({ kind: 'ok', text: '已保存' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 吸顶操作栏 */}
      <div className="sticky top-0 z-10 -mx-1 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <a href="/paper-center" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            <ArrowLeft className="size-3.5" />
            出卷中心
          </a>
          <NotebookPen className="size-4 text-primary" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="题目标题（必填）"
            className="h-9 max-w-md flex-1 font-medium"
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <Checkbox checked={hidden} onCheckedChange={(v) => setHidden(!!v)} />
            对学生隐藏
          </label>
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="标签（逗号分隔，可空）"
            className="h-9 w-52 text-xs"
          />
          <Badge variant="secondary" className="text-xs">
            {questions.length} 题 · 共 {totalScore} 分
          </Badge>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </div>
        {msg ? (
          <p className={`mt-2 text-xs ${msg.kind === 'err' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
            {msg.text}
          </p>
        ) : null}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {/* 左：卷首说明（折叠） + 小题列表 */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="p-4">
              <button
                type="button"
                onClick={() => setShowContent((v) => !v)}
                className="flex w-full items-center gap-1.5 text-sm font-medium"
              >
                {showContent ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                卷首说明（可选）
                <span className="text-xs font-normal text-muted-foreground">
                  ——显示在所有小题之前的公共材料/说明，留空则学生端不显示
                </span>
              </button>
              {showContent ? (
                <div className="mt-3">
                  <MarkdownEditor value={content} onChange={setContent} minHeight={160} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <ObjectiveEditor questions={questions} onChange={setQuestions} />
        </div>

        {/* 右：学生视角预览（吸顶跟随） */}
        <div className="min-w-0 xl:sticky xl:top-20">
          <ObjectivePreview questions={questions} />
        </div>
      </div>
    </div>
  );
}
