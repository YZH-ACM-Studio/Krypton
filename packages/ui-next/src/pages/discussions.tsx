import { motion } from 'motion/react';
import { ChevronRight, Edit, Lock, MessageSquare, Send, Smile, Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

function ReactionBar({
  react,
  status,
  nodeType,
  id,
  canReact,
}: {
  react?: R;
  status?: R;
  nodeType: 'did' | 'drid';
  id: string;
  canReact?: boolean;
}) {
  const entries = Object.entries(react || {}).filter(([, count]) => Number(count) > 0);
  if (!entries.length && !canReact) return null;
  const quick = ['👍', '👀', '🎉', '❤️'];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {entries.map(([emoji, count]) => {
        const active = !!status?.[emoji];
        return (
          <form key={emoji} method="post">
            <input type="hidden" name="operation" value="reaction" />
            <input type="hidden" name="nodeType" value={nodeType} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="emoji" value={emoji} />
            {active ? <input type="hidden" name="reverse" value="true" /> : null}
            <Button type="submit" variant={active ? 'secondary' : 'outline'} size="sm" className="h-7 px-2 text-xs" disabled={!canReact}>
              <span>{emoji}</span>
              <span className="font-mono">{String(count)}</span>
            </Button>
          </form>
        );
      })}
      {canReact ? (
        <div className="flex flex-wrap gap-1">
          {quick.filter((emoji) => !react?.[emoji]).map((emoji) => (
            <form key={emoji} method="post">
              <input type="hidden" name="operation" value="reaction" />
              <input type="hidden" name="nodeType" value={nodeType} />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="emoji" value={emoji} />
              <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                {emoji}
              </Button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DiscussionsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const ddocs: R[] = data.ddocs || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
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
            const owner = getUser(udict, d.owner);
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
  const page = Number(data.page) || 1;
  const pcount = Number(data.pcount) || 1;
  const drcount = Number(data.drcount) || 1;
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const owner = getUser(udict, ddoc.owner);
  const locale = bs.locale;
  const discussionUrl = replaceRouteTokens(bs.urls.discussionDetail, { DID: String(ddoc._id || ddoc.docId || '') });
  const isOwner = Number(ddoc.owner) === Number(bs.user.id);
  const permissions: R = data.permissions || {};
  const replyPermissions: R = permissions.replies || {};
  const reactions: R = data.reactions || {};
  const did = String(ddoc._id || ddoc.docId || '');
  const canEditDiscussion = permissions.canEditDiscussion ?? isOwner;
  const canLockDiscussion = permissions.canLockDiscussion ?? isOwner;
  const canReply = permissions.canReply ?? bs.user.signedIn;
  const canReact = !!permissions.canReact;

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
          {ddoc.pin ? <Badge variant="secondary" className="ml-1">置顶</Badge> : null}
          {ddoc.lock ? <Badge variant="outline" className="ml-1">已锁定</Badge> : null}
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {ddoc.content ? (
            <MarkdownView content={ddoc.content} className="prose prose-sm dark:prose-invert max-w-none" />
          ) : (
            <p className="text-sm text-muted-foreground">无内容</p>
          )}
          <ReactionBar
            react={ddoc.react}
            status={reactions[did]}
            nodeType="did"
            id={did}
            canReact={canReact}
          />
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
            {bs.user.signedIn && (
              <form method="post">
                <input type="hidden" name="operation" value={data.dsdoc?.star ? 'unstar' : 'star'} />
                <Button type="submit" variant="outline" size="sm">
                  <Star className="mr-1 size-3.5" />{data.dsdoc?.star ? '取消收藏' : '收藏'}
                </Button>
              </form>
            )}
            {canLockDiscussion ? (
              <form method="post">
                <input type="hidden" name="operation" value="set_lock" />
                {!ddoc.lock && <input type="hidden" name="lock" value="true" />}
                <Button type="submit" variant="outline" size="sm">
                  <Lock className="mr-1 size-3.5" />{ddoc.lock ? '解除锁定' : '锁定'}
                </Button>
              </form>
            ) : null}
            {canEditDiscussion ? (
              <Button asChild variant="outline" size="sm">
                <a href={`${discussionUrl}/edit`}>
                  <Edit className="mr-1 size-3.5" />编辑
                </a>
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <a href="/wiki/help#contact">
                <Smile className="mr-1 size-3.5" />举报
              </a>
            </Button>
            {permissions.canDeleteDiscussion ? (
              <Button asChild variant="ghost" size="sm" className="text-destructive">
                <a href={`${discussionUrl}/edit`}>
                  <Trash2 className="mr-1 size-3.5" />删除
                </a>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {canReply && !ddoc.lock ? (
        <Card>
          <CardHeader><CardTitle className="text-base">发表回复</CardTitle></CardHeader>
          <CardContent>
            <form method="post" className="space-y-3">
              <input type="hidden" name="operation" value="reply" />
              <MarkdownEditor name="content" value="" minHeight={180} />
              <div className="flex justify-end">
                <Button type="submit">
                  <Send className="mr-1 size-4" />发表回复
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {drdocs.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{drcount} 条回复</h2>
          {drdocs.map((reply, i) => {
            const rOwner = getUser(udict, reply.owner);
            const tailReplies: R[] = reply.reply || [];
            const rid = String(reply._id || reply.docId || i);
            const perms = replyPermissions[rid] || {};
            return (
              <Card key={rid}>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Avatar className="size-6">
                        <AvatarFallback className="text-[8px]">{makeInitials(rOwner?.uname || '?')}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{rOwner?.uname || '匿名'}</span>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(reply.updateAt || reply._id, locale)}</span>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {perms.canEdit ? (
                        <details className="relative">
                          <summary className="list-none">
                            <Button type="button" variant="outline" size="sm">
                              <Edit className="size-3.5" />编辑
                            </Button>
                          </summary>
                          <div className="mt-2 min-w-[min(560px,80vw)] rounded-md border bg-card p-3 shadow-sm">
                            <form method="post" className="space-y-3">
                              <input type="hidden" name="operation" value="edit_reply" />
                              <input type="hidden" name="drid" value={rid} />
                              <MarkdownEditor name="content" value={reply.content || ''} minHeight={160} />
                              <div className="flex justify-end">
                                <Button type="submit" size="sm">保存</Button>
                              </div>
                            </form>
                          </div>
                        </details>
                      ) : null}
                      {perms.canDelete ? (
                        <form method="post" onSubmit={(event) => {
                          if (!window.confirm('确定删除这条回复？')) event.preventDefault();
                        }}>
                          <input type="hidden" name="operation" value="delete_reply" />
                          <input type="hidden" name="drid" value={rid} />
                          <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                            <Trash2 className="size-3.5" />删除
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  {reply.content ? (
                    <MarkdownView content={reply.content} className="prose prose-sm dark:prose-invert max-w-none" />
                  ) : null}
                  <ReactionBar
                    react={reply.react}
                    status={reactions[rid]}
                    nodeType="drid"
                    id={rid}
                    canReact={canReact}
                  />
                  {tailReplies.length > 0 && (
                    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                      {tailReplies.map((tail) => {
                        const tailOwner = getUser(udict, tail.owner);
                        const tid = String(tail._id);
                        const tailPerms = perms.tail?.[tid] || {};
                        return (
                          <div key={tid} className="space-y-2 border-b pb-3 last:border-b-0 last:pb-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{tailOwner?.uname || `UID ${tail.owner}`}</span>
                                <span>{formatRelativeTime(tail.updateAt || tail._id, locale)}</span>
                              </div>
                              <div className="flex gap-1">
                                {tailPerms.canEdit ? (
                                  <details>
                                    <summary className="list-none">
                                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs">编辑</Button>
                                    </summary>
                                    <div className="mt-2 min-w-[min(520px,78vw)] rounded-md border bg-card p-3 shadow-sm">
                                      <form method="post" className="space-y-3">
                                        <input type="hidden" name="operation" value="edit_tail_reply" />
                                        <input type="hidden" name="drid" value={rid} />
                                        <input type="hidden" name="drrid" value={tid} />
                                        <MarkdownEditor name="content" value={tail.content || ''} minHeight={140} />
                                        <div className="flex justify-end">
                                          <Button type="submit" size="sm">保存</Button>
                                        </div>
                                      </form>
                                    </div>
                                  </details>
                                ) : null}
                                {tailPerms.canDelete ? (
                                  <form method="post" onSubmit={(event) => {
                                    if (!window.confirm('确定删除这条楼中楼回复？')) event.preventDefault();
                                  }}>
                                    <input type="hidden" name="operation" value="delete_tail_reply" />
                                    <input type="hidden" name="drid" value={rid} />
                                    <input type="hidden" name="drrid" value={tid} />
                                    <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">删除</Button>
                                  </form>
                                ) : null}
                              </div>
                            </div>
                            <MarkdownView content={tail.content || ''} className="prose prose-sm dark:prose-invert max-w-none" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {canReply && !ddoc.lock ? (
                    <form method="post" className="space-y-2">
                      <input type="hidden" name="operation" value="tail_reply" />
                      <input type="hidden" name="drid" value={rid} />
                      <textarea
                        name="content"
                        rows={2}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder={`回复 ${rOwner?.uname || '该用户'}…`}
                      />
                      <div className="flex justify-end">
                        <Button type="submit" size="sm" variant="outline">
                          <Send className="mr-1 size-3" />回复
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      <Pagination current={page} total={pcount} baseUrl={discussionUrl} />

      {canReply ? (
        <Card>
          <CardHeader><CardTitle className="text-base">继续回复</CardTitle></CardHeader>
          <CardContent>
            <form method="post" className="space-y-3">
              <input type="hidden" name="operation" value="reply" />
              <MarkdownEditor name="content" value="" minHeight={220} />
              <div className="mt-3 flex justify-end">
                <Button type="submit" disabled={ddoc.lock}>
                  <Send className="mr-1 size-4" />{ddoc.lock ? '讨论已锁定' : '发表回复'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
  );
}
