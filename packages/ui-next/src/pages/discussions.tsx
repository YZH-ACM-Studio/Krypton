import { motion } from 'motion/react';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Pagination } from '@/components/ui/pagination';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

export function DiscussionsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const ddocs: R[] = data.ddocs || [];
  const page = Number(data.page) || 1;
  const dpcount = Number(data.dpcount) || 1;
  const vnode: R = data.vnode || {};
  const locale = bs.locale;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{vnode.title ? `讨论 · ${vnode.title}` : '讨论'}</h1>
          <p className="text-sm text-muted-foreground">共 {data.dcount || ddocs.length} 条讨论</p>
        </div>
        <Button asChild>
          <a href={`${bs.urls.discussions}/create`}>发起讨论</a>
        </Button>
      </div>

      {ddocs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">暂无讨论</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {ddocs.map((d) => {
            const owner = getUser(bs.udict, d.owner);
            return (
              <a
                key={String(d._id)}
                href={replaceRouteTokens(bs.urls.discussionDetail, { DID: String(d._id) })}
                className="block"
              >
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-start gap-3 p-4">
                    <Avatar className="mt-0.5 size-8">
                      <AvatarFallback className="text-xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.title || '无标题'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{owner?.uname || '匿名'}</span>
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          <MessageSquare className="size-3" />{d.nReply || 0} 回复
                        </span>
                        <span>·</span>
                        <span>{formatRelativeTime(d.updateAt, locale)}</span>
                      </div>
                    </div>
                    {d.pin ? <Badge variant="default">置顶</Badge> : null}
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>
      )}

      <Pagination current={page} total={dpcount} baseUrl={bs.urls.discussions} />
    </motion.div>
  );
}

export function DiscussionDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const ddoc: R = data.ddoc || {};
  const drdocs: R[] = data.drdocs || [];
  const drp = Number(data.drp) || 1;
  const drcount = Number(data.drcount) || 1;
  const owner = getUser(bs.udict, ddoc.owner);
  const locale = bs.locale;

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <a href={bs.urls.discussions} className="hover:text-primary">讨论</a>
          <ChevronRight className="size-3" />
        </div>
        <h1 className="mt-1 text-2xl font-bold">{ddoc.title || '讨论'}</h1>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Avatar className="size-5">
            <AvatarFallback className="text-[8px]">{makeInitials(owner?.uname || '?')}</AvatarFallback>
          </Avatar>
          <span>{owner?.uname || '匿名'}</span>
          <span>·</span>
          <span>{formatRelativeTime(ddoc.updateAt, locale)}</span>
          <span>·</span>
          <span>{ddoc.views || 0} 浏览</span>
        </div>
      </div>

      {/* Main post */}
      <Card>
        <CardContent className="p-6">
          {ddoc.content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: ddoc.content }} />
          ) : (
            <p className="text-sm text-muted-foreground">无内容</p>
          )}
        </CardContent>
      </Card>

      {/* Replies */}
      {drdocs.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{drcount} 条回复</h2>
          {drdocs.map((reply, i) => {
            const rOwner = getUser(bs.udict, reply.owner);
            return (
              <Card key={String(reply._id || i)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[8px]">{makeInitials(rOwner?.uname || '?')}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{rOwner?.uname || '匿名'}</span>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(reply.updateAt, locale)}</span>
                  </div>
                  {reply.content ? (
                    <div className="mt-3 prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: reply.content }} />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Reply form */}
      <Card>
        <CardHeader><CardTitle className="text-base">回复</CardTitle></CardHeader>
        <CardContent>
          <form method="post">
            <textarea
              name="content"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={4}
              placeholder="写下你的回复…"
            />
            <div className="mt-3 flex justify-end">
              <Button type="submit">发表回复</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
