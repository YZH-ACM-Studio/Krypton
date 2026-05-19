import { motion } from 'motion/react';
import { BookOpen, Edit3, Eye, MessageCircle, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatDateTime, makeInitials } from '@/lib/format';

type R = Record<string, any>;

function blogMainUrl(uid: string | number) {
  return `/blog/${encodeURIComponent(String(uid))}`;
}

function blogDetailUrl(uid: string | number, did: string | number) {
  return `${blogMainUrl(uid)}/${encodeURIComponent(String(did))}`;
}

function blogEditUrl(uid: string | number, did: string | number) {
  return `${blogDetailUrl(uid, did)}/edit`;
}

export function BlogMainPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const posts: R[] = data.ddocs || [];
  const udoc: GenericUserDoc = data.udoc || {};
  const page = Number(data.page) || 1;
  const total = Number(data.dpcount) || 1;
  const ownerId = udoc._id || bs.user.id;
  const isOwner = bs.user.signedIn && Number(bs.user.id) === Number(ownerId);

  return (
    <BlogShell
      title={`${udoc.uname || '用户'} 的博客`}
      udoc={udoc}
      aside={isOwner ? (
        <Button asChild className="w-full gap-2">
          <a href={`${blogMainUrl(ownerId)}/create`}>
            <Plus className="size-4" />
            新建文章
          </a>
        </Button>
      ) : null}
    >
      {posts.length ? (
        <div className="space-y-3">
          {posts.map((post) => (
            <a
              key={String(post._id || post.docId)}
              href={blogDetailUrl(ownerId, post._id || post.docId)}
              className="block rounded-md border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{post.title || '未命名文章'}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDateTime(post.updateAt || post._id, bs.locale)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Badge variant="outline" className="gap-1">
                    <Eye className="size-3" />
                    {post.views || 0}
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <MessageCircle className="size-3" />
                    {post.nReply || 0}
                  </Badge>
                </div>
              </div>
            </a>
          ))}
          <Pagination current={page} total={total} baseUrl={blogMainUrl(ownerId)} />
        </div>
      ) : (
        <EmptyBlog />
      )}
    </BlogShell>
  );
}

export function BlogDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const post: R = data.ddoc || {};
  const udoc: GenericUserDoc = data.udoc || {};
  const ownerId = udoc._id || post.owner || bs.user.id;
  const canEdit = bs.user.signedIn && (Number(bs.user.id) === Number(ownerId) || Boolean(bs.user.priv));

  return (
    <BlogShell title={post.title || '博客文章'} udoc={udoc}>
      <article className="space-y-4">
        <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <a href={blogMainUrl(ownerId)} className="text-sm text-primary hover:underline">
              {udoc.uname || '用户'} 的博客
            </a>
            <h1 className="mt-2 text-2xl font-semibold">{post.title || '未命名文章'}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatDateTime(post.updateAt || post._id, bs.locale)}
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="gap-1">
              <Eye className="size-3" />
              {post.views || 0}
            </Badge>
            {canEdit ? (
              <Button asChild variant="outline" size="sm" className="gap-2">
                <a href={blogEditUrl(ownerId, post.docId || post._id)}>
                  <Pencil className="size-4" />
                  编辑
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        <MarkdownView content={post.content || ''} />
      </article>
    </BlogShell>
  );
}

export function BlogEditPage() {
  const bs = useBootstrap();
  const post: R = bs.page.data.ddoc || {};
  const isEdit = Boolean(post._id || post.docId);
  const ownerId = post.owner || bs.user.id;

  return (
    <BlogShell title={isEdit ? '编辑博客' : '新建博客'} udoc={bs.page.data.udoc || { _id: ownerId, uname: bs.user.name }}>
      <form method="post" className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="blog-title" className="text-sm font-medium">标题</label>
          <Input
            id="blog-title"
            name="title"
            defaultValue={post.title || ''}
            autoFocus
            required
            placeholder="写一个清楚的标题"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">内容</label>
          <MarkdownEditor name="content" value={post.content || ''} minHeight={500} preferredLang={bs.locale} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {isEdit ? (
            <Button
              type="submit"
              name="operation"
              value="delete"
              variant="outline"
              className="gap-2"
              onClick={(event) => {
                if (!window.confirm('确认删除这篇博客？')) event.preventDefault();
              }}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => window.history.back()}>
            取消
          </Button>
          <Button type="submit" name="operation" value={isEdit ? 'update' : 'create'} className="gap-2">
            <Save className="size-4" />
            {isEdit ? '更新' : '发布'}
          </Button>
        </div>
      </form>
    </BlogShell>
  );
}

function BlogShell({
  title,
  udoc,
  aside,
  children,
}: {
  title: string;
  udoc: GenericUserDoc;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="grid gap-5 lg:grid-cols-[1fr_260px]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <main className="min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BookOpen className="size-5 text-primary" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>
      <aside className="space-y-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback>{makeInitials(udoc.uname || 'K')}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">{udoc.uname || '用户'}</p>
                <p className="text-xs text-muted-foreground">UID {udoc._id || '—'}</p>
              </div>
            </div>
            {udoc.bio ? (
              <MarkdownView
                content={udoc.bio}
                className="mt-3 text-sm text-muted-foreground"
              />
            ) : null}
          </CardContent>
        </Card>
        {aside ? <Card><CardContent className="p-4">{aside}</CardContent></Card> : null}
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <a href={blogMainUrl(udoc._id || '')} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <BookOpen className="size-4" />
              查看博客
            </a>
            <a href={`/user/${udoc._id || ''}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <Edit3 className="size-4" />
              用户主页
            </a>
          </CardContent>
        </Card>
      </aside>
    </motion.div>
  );
}

function EmptyBlog() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-14 text-center">
      <BookOpen className="size-10 text-muted-foreground/50" />
      <div>
        <p className="text-sm font-medium">还没有博客文章</p>
        <p className="mt-1 text-xs text-muted-foreground">发布第一篇文章后会显示在这里。</p>
      </div>
    </div>
  );
}
