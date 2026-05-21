import { motion } from 'motion/react';
import { ArrowLeft, FileUp, Flag, Send, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

export function ProblemHackPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const rid = data.rid || '';
  const pid = pdoc.pid || pdoc.docId || pdoc._id;
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid || '') });

  return (
    <motion.div
      className="grid gap-5 lg:grid-cols-[1fr_260px]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <main className="min-w-0 space-y-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <a href={problemUrl}>
              <ArrowLeft className="size-4" />
            </a>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">Hack 提交</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              #{String(rid).slice(-8)} · {pdoc.title || data.title || '题目'}
            </p>
          </div>
          <Badge variant="outline" className="ml-auto">{pdoc.pid || pdoc.docId || 'Problem'}</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flag className="size-4 text-primary" />
              构造 Hack 数据
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="post" encType="multipart/form-data" className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="hack-input" className="text-sm font-medium">输入数据</label>
                <textarea
                  id="hack-input"
                  name="input"
                  rows={18}
                  autoFocus
                  spellCheck={false}
                  className="w-full resize-y rounded-md border bg-background p-4 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="在这里粘贴或编写能卡掉目标提交的输入数据"
                />
              </div>

              <div className="grid gap-4 rounded-md border bg-muted/30 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <label htmlFor="hack-file" className="flex items-center gap-2 text-sm font-medium">
                    <FileUp className="size-4 text-primary" />
                    上传输入文件
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">适合较大的测试数据；如果同时填写文本输入，服务端会优先使用上传文件。</p>
                </div>
                <input
                  id="hack-file"
                  type="file"
                  name="file"
                  className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
                />
              </div>

              <label className="flex items-start gap-3 rounded-md border p-4">
                <Checkbox
                  name="autoOrganizeInput" className="mt-1"
                 />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" />
                    自动整理输入格式
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    自动调整换行并移除部分多余空白，适合从网页或文档复制来的数据。
                  </span>
                </span>
              </label>

              <div className="flex justify-end">
                <Button type="submit" className="gap-2">
                  <Send className="size-4" />
                  提交 Hack
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">目标信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="题目" value={pdoc.title || data.title || '—'} />
            <InfoRow label="题号" value={String(pdoc.pid || pdoc.docId || '—')} />
            <InfoRow label="目标提交" value={String(rid || '—')} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
            Hack 数据会作为一次特殊提交进入评测队列。请只提交用于证明目标程序错误的最小输入。
          </CardContent>
        </Card>
      </aside>
    </motion.div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
