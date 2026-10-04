/**
 * Discussion create / edit pages.
 */

import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
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

function DiscussionBackButton({ href, onClick }: { href?: string | null; onClick?: () => void }) {
  if (href) {
    return (
      <Button asChild variant="ghost" size="sm" iconOnly>
        <a href={href} aria-label="返回">
          <ArrowLeft />
        </a>
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="sm" iconOnly aria-label="返回" onClick={onClick}>
      <ArrowLeft />
    </Button>
  );
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
    <Page width="form">
      <PageHeader
        title="发起讨论"
        description={vnode.title || undefined}
        actions={backUrl ? <DiscussionBackButton href={backUrl} /> : <DiscussionBackButton onClick={() => window.history.back()} />}
      />

      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="标题" htmlFor="title" required>
            <Input id="title" name="title" required autoFocus placeholder="讨论标题" />
          </FormField>

          <FormField label="内容 (Markdown)">
            <MarkdownEditor name="content" value="" minHeight={220} />
          </FormField>

          {canHighlightDiscussion || canPinDiscussion ? (
            <div className="flex flex-wrap items-center gap-4">
              {canHighlightDiscussion ? (
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Switch name="highlight" value="true" />
                  高亮
                </label>
              ) : null}
              {canPinDiscussion ? (
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Switch name="pin" value="true" />
                  置顶
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="submit" variant="primary">
              <Save />
              发布
            </Button>
          </div>
        </form>
      </Panel>
    </Page>
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
    <Page width="form">
      <PageHeader title="编辑讨论" actions={<DiscussionBackButton href={detailUrl} />} />

      <Panel>
        <form method="post" className="flex flex-col gap-5">
          <FormField label="标题" htmlFor="title" required>
            <Input id="title" name="title" defaultValue={ddoc.title || ''} required />
          </FormField>

          <FormField label="内容 (Markdown)">
            <MarkdownEditor name="content" value={ddoc.content || ''} minHeight={220} />
          </FormField>

          {canHighlightDiscussion || canPinDiscussion ? (
            <div className="flex flex-wrap items-center gap-4">
              {canHighlightDiscussion ? (
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Switch name="highlight" value="true" defaultChecked={ddoc.highlight} />
                  高亮
                </label>
              ) : null}
              {canPinDiscussion ? (
                <label className="flex items-center gap-2 text-sm text-fg">
                  <Switch name="pin" value="true" defaultChecked={ddoc.pin} />
                  置顶
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="submit" variant="primary" name="operation" value="update">
              <Save />
              保存
            </Button>
          </div>
        </form>
        {canDeleteDiscussion ? (
          <form
            method="post"
            className="mt-8 flex flex-wrap items-center border-t border-line pt-6"
            onSubmit={(e) => {
              void confirmFormSubmit(e, '删除后不能恢复。', {
                destructive: true,
                title: `删除讨论「${ddoc.title?.trim() || '此讨论'}」？`,
                confirmLabel: '删除',
              });
            }}
          >
            <input type="hidden" name="operation" value="delete" />
            <Button type="submit" variant="danger-soft" size="sm">
              <Trash2 />
              删除
            </Button>
          </form>
        ) : null}
      </Panel>
    </Page>
  );
}
