import { BookOpen, Edit3, Eye, MessageCircle, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, makeInitials } from '@/lib/format';
import { hasPriv, PRIV } from '@/lib/perms';

interface BlogPost {
  _id?: string | number;
  docId?: string | number;
  owner?: string | number;
  title?: string;
  content?: string;
  updateAt?: unknown;
  views?: number;
  nReply?: number;
}

interface BlogUser {
  _id?: string | number;
  uname?: string;
  bio?: string;
}

interface BlogPageData {
  ddocs?: BlogPost[];
  ddoc?: BlogPost;
  udoc?: BlogUser;
  page?: string | number;
  dpcount?: string | number;
}

function blogMainUrl(uid: string | number) {
  return `/blog/${encodeURIComponent(String(uid))}`;
}

function blogDetailUrl(uid: string | number, did: unknown) {
  return `${blogMainUrl(uid)}/${encodeURIComponent(String(did))}`;
}

function blogEditUrl(uid: string | number, did: unknown) {
  return `${blogDetailUrl(uid, did)}/edit`;
}

function BlogProfile({ udoc }: { udoc: BlogUser }) {
  const profileId = udoc._id || '';
  return (
    <div className="flex w-full flex-col gap-4 lg:w-60 lg:shrink-0">
      <Panel>
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarFallback>{makeInitials(udoc.uname || 'K')}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{udoc.uname || '用户'}</p>
            <p className="text-xs text-fg-subtle">UID {udoc._id || '—'}</p>
          </div>
        </div>
        {udoc.bio ? <MarkdownView content={udoc.bio} className="mt-3 text-sm text-fg-muted" /> : null}
      </Panel>
      <Panel>
        <div className="flex flex-col gap-2 text-sm">
          <a href={blogMainUrl(profileId)} className="inline-flex items-center gap-2 text-fg-muted hover:text-fg">
            <BookOpen className="size-4" />
            查看博客
          </a>
          <a href={`/user/${profileId}`} className="inline-flex items-center gap-2 text-fg-muted hover:text-fg">
            <Edit3 className="size-4" />
            用户主页
          </a>
        </div>
      </Panel>
    </div>
  );
}

function EmptyBlog() {
  return <EmptyState icon={<BookOpen />} title="还没有博客文章" description="发布第一篇文章后会显示在这里。" />;
}

export function BlogMainPage() {
  const bs = useBootstrap();
  const data = bs.page.data as BlogPageData;
  const posts = data.ddocs || [];
  const udoc = data.udoc || {};
  const page = Number(data.page) || 1;
  const total = Number(data.dpcount) || 1;
  const ownerId = udoc._id || bs.user.id;
  const isOwner = bs.user.signedIn && Number(bs.user.id) === Number(ownerId);

  return (
    <Page width="wide">
      <PageHeader
        title={`${udoc.uname || '用户'} 的博客`}
        actions={
          isOwner ? (
            <Button asChild variant="primary" className="w-full sm:w-auto">
              <a href={`${blogMainUrl(ownerId)}/create`}>
                <Plus />
                新建文章
              </a>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          {posts.length ? (
            <div className="flex flex-col gap-4">
              <Panel flush>
                <div className="divide-y divide-line-subtle">
                  {posts.map((post) => (
                    <a
                      key={String(post._id || post.docId)}
                      href={blogDetailUrl(ownerId, post._id || post.docId)}
                      className="block p-4 hover:bg-surface-hover"
                    >
                      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h2 className="min-w-0 break-words text-lg font-semibold text-fg">{post.title || '未命名文章'}</h2>
                          <p className="mt-1 text-xs text-fg-subtle">{formatDateTime(post.updateAt || post._id, bs.locale)}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Badge variant="outline" size="sm">
                            <Eye className="size-3" />
                            {post.views || 0}
                          </Badge>
                          <Badge variant="outline" size="sm">
                            <MessageCircle className="size-3" />
                            {post.nReply || 0}
                          </Badge>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </Panel>
              <Pagination current={page} total={total} baseUrl={blogMainUrl(ownerId)} />
            </div>
          ) : (
            <EmptyBlog />
          )}
        </div>
        <BlogProfile udoc={udoc} />
      </div>
    </Page>
  );
}

export function BlogDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as BlogPageData;
  const post = data.ddoc || {};
  const udoc = data.udoc || {};
  const ownerId = udoc._id || post.owner || bs.user.id;
  const canEdit = bs.user.signedIn && (Number(bs.user.id) === Number(ownerId) || hasPriv(bs.user.priv, PRIV.PRIV_EDIT_SYSTEM));
  const title = post.title || '未命名文章';

  return (
    <Page width="prose">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: `${udoc.uname || '用户'} 的博客`, href: blogMainUrl(ownerId) }, { label: title }]} />}
        title={title}
        meta={
          <>
            <span>{formatDateTime(post.updateAt || post._id, bs.locale)}</span>
            <Badge variant="outline" size="sm">
              <Eye className="size-3" />
              {post.views || 0}
            </Badge>
          </>
        }
        actions={
          canEdit ? (
            <Button asChild variant="secondary" size="sm">
              <a href={blogEditUrl(ownerId, post.docId || post._id)}>
                <Pencil />
                编辑
              </a>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <article className="krypton-prose min-w-0 flex-1 overflow-x-auto">
          <MarkdownView content={post.content || ''} />
        </article>
        <BlogProfile udoc={udoc} />
      </div>
    </Page>
  );
}

export function BlogEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as BlogPageData;
  const post = data.ddoc || {};
  const isEdit = Boolean(post._id || post.docId);
  const ownerId = post.owner || bs.user.id;

  return (
    <Page width="form">
      <PageHeader title={isEdit ? '编辑博客' : '新建博客'} />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <form method="post">
            <Panel
              footer={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => window.history.back()}>
                    取消
                  </Button>
                  <Button type="submit" variant="primary" name="operation" value={isEdit ? 'update' : 'create'}>
                    <Save />
                    {isEdit ? '更新' : '发布'}
                  </Button>
                </div>
              }
            >
              <div className="flex flex-col gap-5">
                <FormField label="标题" htmlFor="blog-title" required>
                  <Input id="blog-title" name="title" defaultValue={post.title || ''} autoFocus required placeholder="写一个清楚的标题" />
                </FormField>
                <FormField label="内容">
                  <MarkdownEditor
                    name="content"
                    value={post.content || ''}
                    minHeight={500}
                    preferredLang={bs.locale}
                    // ds-allow DS004: 编辑器只接受像素 minHeight，无法把外壳限制在视口剩余高度内
                    className="[&_.krypton-md-shell]:md:h-[min(500px,calc(100dvh-16rem))]"
                  />
                </FormField>
              </div>
            </Panel>
          </form>
          {isEdit ? (
            <Panel>
              <form
                method="post"
                className="flex justify-end"
                onSubmit={(event) => {
                  void confirmFormSubmit(event, '确认删除这篇博客？', { destructive: true });
                }}
              >
                <input type="hidden" name="operation" value="delete" />
                <Button type="submit" variant="danger-soft">
                  <Trash2 />
                  删除
                </Button>
              </form>
            </Panel>
          ) : null}
        </div>
        <BlogProfile udoc={data.udoc || { _id: ownerId, uname: bs.user.name }} />
      </div>
    </Page>
  );
}
