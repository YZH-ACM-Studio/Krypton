/**
 * Discussion create / edit pages.
 */

import { motion } from 'motion/react';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Switch } from '@/components/ui/switch';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

interface DiscussionNode {
  title?: string;
}

interface DiscussionDocument {
  _id?: string | number;
  title?: string;
  content?: string;
  highlight?: boolean;
  pin?: boolean;
}

interface DiscussionPermissions {
  canDeleteDiscussion?: unknown;
  canHighlightDiscussion?: unknown;
  canPinDiscussion?: unknown;
}

interface DiscussionCreatePageData {
  vnode?: DiscussionNode;
  examMode?: { urls?: { discussion?: string } };
  permissions?: DiscussionPermissions;
}

interface DiscussionEditPageData {
  ddoc?: DiscussionDocument;
  permissions?: DiscussionPermissions;
}

/* ---------- Discussion Create ---------- */

export function DiscussionCreatePage() {
  const bs = useBootstrap();
  const data = bs.page.data as DiscussionCreatePageData;
  const vnode = data.vnode || {};
  const backUrl = data.examMode?.urls?.discussion || null;
  const canHighlightDiscussion = data.permissions?.canHighlightDiscussion === true;
  const canPinDiscussion = data.permissions?.canPinDiscussion === true;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        {backUrl ? (
          <Button asChild variant="ghost" size="icon">
            <a href={backUrl}>
              <ArrowLeft className="size-4" />
            </a>
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
              <label htmlFor="title" className="text-sm font-medium">
                标题
              </label>
              <Input id="title" name="title" required autoFocus placeholder="讨论标题" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">内容 (Markdown)</label>
              <MarkdownEditor name="content" value="" minHeight={320} />
            </div>

            {canHighlightDiscussion || canPinDiscussion ? (
              <div className="flex items-center gap-4">
                {canHighlightDiscussion ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch name="highlight" value="true" />
                    高亮
                  </label>
                ) : null}
                {canPinDiscussion ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch name="pin" value="true" />
                    置顶
                  </label>
                ) : null}
              </div>
            ) : null}

            <Button type="submit">
              <Save className="mr-1 size-4" />
              发布
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Discussion Edit ---------- */

export function DiscussionEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DiscussionEditPageData;
  const ddoc = data.ddoc || {};
  const canDeleteDiscussion = data.permissions?.canDeleteDiscussion === true;
  const canHighlightDiscussion = data.permissions?.canHighlightDiscussion === true;
  const canPinDiscussion = data.permissions?.canPinDiscussion === true;
  const detailUrl = replaceRouteTokens(bs.urls.discussionDetail, { DID: String(ddoc._id) });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={detailUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <h1 className="text-xl font-semibold">编辑讨论</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">
                标题
              </label>
              <Input id="title" name="title" defaultValue={ddoc.title || ''} required />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">内容 (Markdown)</label>
              <MarkdownEditor name="content" value={ddoc.content || ''} minHeight={320} />
            </div>

            {canHighlightDiscussion || canPinDiscussion ? (
              <div className="flex items-center gap-4">
                {canHighlightDiscussion ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch name="highlight" value="true" defaultChecked={ddoc.highlight} />
                    高亮
                  </label>
                ) : null}
                {canPinDiscussion ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch name="pin" value="true" defaultChecked={ddoc.pin} />
                    置顶
                  </label>
                ) : null}
              </div>
            ) : null}

            <Separator />

            <div className="flex items-center gap-3">
              <Button type="submit" name="operation" value="update">
                <Save className="mr-1 size-4" />
                保存
              </Button>
            </div>
          </form>
          {canDeleteDiscussion ? (
            <form
              method="post"
              className="flex items-center"
              onSubmit={(e) => {
                void confirmFormSubmit(e, '确定要删除此讨论吗？', { destructive: true });
              }}
            >
              <input type="hidden" name="operation" value="delete" />
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="mr-1 size-3" />
                删除
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
