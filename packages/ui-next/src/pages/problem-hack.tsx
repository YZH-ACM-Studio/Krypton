import { ArrowLeft, FileUp, Flag, Send, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form';
import { Page, PageHeader } from '@/components/ui/page';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

interface ProblemHackDocument {
  _id?: string | number;
  docId?: string | number;
  pid?: string | number;
  title?: string;
}

interface ProblemHackPageData {
  pdoc?: ProblemHackDocument;
  rid?: string | number;
  title?: string;
}

export function ProblemHackPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ProblemHackPageData;
  const pdoc = data.pdoc || {};
  const rid = data.rid || '';
  const pid = pdoc.pid || pdoc.docId || pdoc._id;
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid || '') });

  return (
    <Page width="form">
      <PageHeader
        title="Hack 提交"
        description={`#${String(rid).slice(-8)} · ${pdoc.title || data.title || '题目'}`}
        meta={<Badge variant="outline">{pdoc.pid || pdoc.docId || 'Problem'}</Badge>}
        actions={
          <Button asChild variant="ghost" size="sm" iconOnly>
            <a href={problemUrl} aria-label="返回题目">
              <ArrowLeft />
            </a>
          </Button>
        }
      />
      {/* ds-allow DS004: sidebar column uses the detail-page grid, rem and fr only */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              <Flag className="size-4 text-fg-subtle" />
              构造 Hack 数据
            </span>
          }
        >
          <form method="post" encType="multipart/form-data" className="flex flex-col gap-5">
            <FormField label="输入数据" htmlFor="hack-input">
              <Textarea
                id="hack-input"
                name="input"
                rows={18}
                autoFocus
                spellCheck={false}
                className="font-mono"
                placeholder="在这里粘贴或编写能卡掉目标提交的输入数据"
              />
            </FormField>

            <FormField
              htmlFor="hack-file"
              label={
                <span className="inline-flex items-center gap-2">
                  <FileUp className="size-4 shrink-0 text-fg-subtle" />
                  上传输入文件
                </span>
              }
              hint="适合较大的测试数据；如果同时填写文本输入，服务端会优先使用上传文件。"
            >
              <input
                id="hack-file"
                type="file"
                name="file"
                className="min-w-0 max-w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg"
              />
            </FormField>

            <Checkbox
              name="autoOrganizeInput"
              className="mt-1"
              label={
                <span className="inline-flex items-center gap-2 font-medium">
                  <Sparkles className="size-4 text-fg-subtle" />
                  自动整理输入格式
                </span>
              }
              description="自动调整换行并移除部分多余空白，适合从网页或文档复制来的数据。"
            />

            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                <Send />
                提交 Hack
              </Button>
            </div>
          </form>
        </Panel>

        <aside className="flex min-w-0 flex-col gap-4">
          <Panel title="目标信息">
            <DescriptionList
              items={[
                { term: '题目', detail: pdoc.title || data.title || '—' },
                { term: '题号', detail: String(pdoc.pid || pdoc.docId || '—') },
                { term: '目标提交', detail: String(rid || '—') },
              ]}
            />
          </Panel>
          <Panel>
            <p className="text-sm text-fg-muted text-pretty">
              Hack 数据会作为一次特殊提交进入评测队列。请只提交用于证明目标程序错误的最小输入。
            </p>
          </Panel>
        </aside>
      </div>
    </Page>
  );
}
