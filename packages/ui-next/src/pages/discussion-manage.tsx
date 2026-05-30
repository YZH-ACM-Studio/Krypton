/**
 * Discussion create / edit pages.
 */

import { motion } from 'motion/react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

/* ---------- Discussion Create ---------- */

export function DiscussionCreatePage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const vnode: R = data.vnode || {};
  const backUrl = data.examMode?.urls?.discussion || null;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        {backUrl ? (
          <Button asChild variant="ghost" size="icon">
            <a href={backUrl}><ArrowLeft className="size-4" /></a>
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div>
          <h1 className="text-xl font-semibold">发起讨论</h1>
          {vnode.title && <p className="text-sm text-muted-foreground">{vnode.title}</p>}
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">标题</label>
              <Input id="title" name="title" required autoFocus placeholder="讨论标题" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">内容 (Markdown)</label>
              <MarkdownEditor name="content" value="" minHeight={320} />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="highlight" value="true"  />
                高亮
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="pin" value="true"  />
                置顶
              </label>
            </div>

            <Button type="submit"><Save className="mr-1 size-4" />发布</Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Discussion Edit ---------- */

export function DiscussionEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const ddoc: R = data.ddoc || {};
  const detailUrl = replaceRouteTokens(bs.urls.discussionDetail, { DID: String(ddoc._id) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={detailUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <h1 className="text-xl font-semibold">编辑讨论</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">标题</label>
              <Input id="title" name="title" defaultValue={ddoc.title || ''} required />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">内容 (Markdown)</label>
              <MarkdownEditor name="content" value={ddoc.content || ''} minHeight={320} />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="highlight" value="true" defaultChecked={ddoc.highlight}  />
                高亮
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="pin" value="true" defaultChecked={ddoc.pin}  />
                置顶
              </label>
            </div>

            <Separator />

            <div className="flex items-center gap-3">
              <Button type="submit" name="operation" value="update"><Save className="mr-1 size-4" />保存</Button>
              <Button
                type="submit"
                name="operation"
                value="delete"
                variant="destructive"
                size="sm"
                formNoValidate
                onClick={(e) => { if (!confirm('确定要删除此讨论吗？')) e.preventDefault(); }}
              >
                <Trash2 className="mr-1 size-3" />删除
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
