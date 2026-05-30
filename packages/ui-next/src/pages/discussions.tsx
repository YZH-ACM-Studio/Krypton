/**
 * Discussion list + detail pages.
 *
 * Adds the features the old Hydro UI had that were missing in the first
 * Krypton port: vnode sidebar, sort tabs, search, last-reply column,
 * reply numbering, history link, draft autosave, keyboard shortcuts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDown,
  AtSign,
  ChevronRight,
  Clock,
  Edit,
  Eye,
  Filter,
  Hash,
  History,
  Lock,
  MessageSquare,
  Pin,
  Quote,
  Reply,
  Search,
  Send,
  Smile,
  Star,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Pagination } from '@/components/ui/pagination';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Shared: reactions                                                  */
/* ────────────────────────────────────────────────────────────────── */

function ReactionBar({ react, status, nodeType, id, canReact }: {
  react?: R; status?: R; nodeType: 'did' | 'drid'; id: string; canReact?: boolean;
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

/* ────────────────────────────────────────────────────────────────── */
/*  Discussion list                                                    */
/* ────────────────────────────────────────────────────────────────── */

type SortKey = 'updateAt' | 'docId' | 'views' | 'nReply';

export function DiscussionsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const ddocs: R[] = data.ddocs || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const page = Number(data.page) || 1;
  const dpcount = Number(data.dpcount) || 1;
  const vnode: R = data.vnode || {};
  const vnodes: R = data.vnodes || {}; // grouped nodes by category
  const locale = bs.locale;
  const examUrls: R = data.examMode?.urls || {};
  const inExamMode = !!data.examMode?.enabled;
  const discussionsBase = examUrls.discussion || bs.urls.discussions;
  const discussionDetailRoute = examUrls.discussionDetail || bs.urls.discussionDetail;
  const createUrl = examUrls.discussionCreate || `${bs.urls.discussions}/create`;

  // Sort key (client-side reordering on the current page; server-side sort
  // would require a query param the backend may not support).
  const [sortKey, setSortKey] = useState<SortKey>('updateAt');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = !q ? ddocs : ddocs.filter((d) => (d.title || '').toLowerCase().includes(q));
    list = [...list].sort((a, b) => {
      const va = Number((a as any)[sortKey] ?? 0);
      const vb = Number((b as any)[sortKey] ?? 0);
      return vb - va;
    });
    // Pinned always first
    return list.sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0));
  }, [ddocs, sortKey, search]);

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
          <p className="text-sm text-muted-foreground">{data.dcount || ddocs.length} 条讨论</p>
        </div>
        <Button asChild>
          <a href={createUrl}>发起讨论</a>
        </Button>
      </div>

      {/* Layout: 220px node sidebar | main */}
      <div className={inExamMode ? 'grid gap-4' : 'grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]'}>
        {/* Node sidebar */}
        {!inExamMode ? <aside className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Filter className="size-3.5" />
                分类
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <NodeList vnodes={vnodes} currentId={vnode?.id} discussionsUrl={bs.urls.discussions} />
              </ScrollArea>
            </CardContent>
          </Card>
        </aside> : null}

        {/* Main */}
        <div className="space-y-3 min-w-0">
          {/* Search + sort */}
          <Card>
            <CardContent className="p-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  placeholder="搜索标题…"
                />
              </div>
              <MiniTabs
                size="sm"
                value={sortKey}
                onValueChange={(v) => setSortKey(v as SortKey)}
                items={[
                  { value: 'updateAt', label: '最新回复' },
                  { value: 'docId', label: '最新发布' },
                  { value: 'nReply', label: '回复数' },
                  { value: 'views', label: '浏览数' },
                ]}
              />
            </CardContent>
          </Card>

          {/* List */}
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {ddocs.length === 0 ? '暂无讨论' : '没有匹配的讨论'}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {filtered.map((d) => <DiscussionRow key={String(d._id)} d={d} udict={udict} locale={locale} discussionsUrl={discussionDetailRoute} />)}
                </div>
              </CardContent>
            </Card>
          )}

          <Pagination current={page} total={dpcount} baseUrl={discussionsBase} />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * `data.vnodes` from hydrooj's discussion handler is a flat **array** of
 * `TYPE_DISCUSSION_NODE` (docType=20) documents — see
 * `packages/hydrooj/src/model/discussion.ts#getNodes`. Each doc has
 * `docId` (the human-readable board name like "题解" / "公告"),
 * `content` (description), and no `title` field.
 *
 * Earlier code treated it as a `Record<docType, vnode>` and Object.entries
 * yielded array-index keys ('0','1','2'…); those plus the missing `title`
 * caused the sidebar to render "undefined" everywhere.
 */
/**
 * Map a hydrooj numeric docType (from `getVnode`) to the URL slug expected
 * by the discussion route (`/discuss/:type/:name`). Must mirror
 * `typeMapper` in `packages/hydrooj/src/handler/discussion.ts`.
 */
function vnodeTypeSlug(type: number | string | undefined): string {
  switch (Number(type)) {
    case 10: return 'problem';
    case 20: return 'node';
    case 30: return 'contest';
    case 40: return 'training';
    default: return 'node';
  }
}

function NodeList({ vnodes, currentId, discussionsUrl }: { vnodes: any; currentId?: any; discussionsUrl: string }) {
  // Normalize to an array — be tolerant if hydrooj ever changes the shape.
  let items: R[] = [];
  if (Array.isArray(vnodes)) {
    items = vnodes;
  } else if (vnodes && typeof vnodes === 'object') {
    // Legacy/alternate shapes: { docType: [vnode, ...] } or { docType: { id: vnode } }
    for (const v of Object.values(vnodes)) {
      if (Array.isArray(v)) items.push(...(v as R[]));
      else if (v && typeof v === 'object') items.push(...(Object.values(v) as R[]));
    }
  }

  const allDiscussionsLink = (
    <a
      href={discussionsUrl}
      className={`block px-3 py-2 text-xs font-medium border-b ${!currentId ? 'bg-accent/50' : 'hover:bg-accent'}`}
    >
      全部讨论
    </a>
  );

  if (items.length === 0) return allDiscussionsLink;

  return (
    <div>
      {allDiscussionsLink}
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">板块</p>
      <div>
        {items.slice(0, 60).map((n) => {
          // `docId` is the board name (string), `_id` is the ObjectId.
          // hydrooj routes accept either form for the `/discuss/node/:name`
          // segment (see `discussion.getNode` → `document.get(domainId, 20, _id)`).
          // We prefer `docId` because it's stable across imports.
          const slugName = n.docId ?? n._id;
          const label = n.docId ?? n.content ?? String(n._id ?? '');
          const active = String(currentId) === String(slugName);
          return (
            <a
              key={String(n._id ?? slugName)}
              href={`${discussionsUrl}/node/${encodeURIComponent(String(slugName))}`}
              className={`flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs transition-colors ${active ? 'bg-accent/60 font-medium' : 'hover:bg-accent'}`}
              title={label}
            >
              <span className="truncate">{label}</span>
              {n.count ? <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{n.count}</span> : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function DiscussionRow({ d, udict, locale, discussionsUrl }: {
  d: R;
  udict: Record<string, GenericUserDoc>;
  locale: string;
  discussionsUrl: string;
}) {
  const owner = getUser(udict, d.owner);
  const lastReplyUser = d.lastRUid ? getUser(udict, d.lastRUid) : null;
  const url = replaceRouteTokens(discussionsUrl, { DID: String(d._id) });
  return (
    <a href={url} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
      <Avatar className="mt-0.5 size-8 shrink-0">
        {owner?.avatarUrl ? <AvatarImage src={String(owner.avatarUrl)} alt={String(owner.uname || '')} /> : null}
        <AvatarFallback className="text-xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {d.pin ? <Pin className="size-3 text-amber-500 shrink-0" /> : null}
          {d.highlight ? <Star className="size-3 text-amber-500 shrink-0" /> : null}
          {d.lock ? <Lock className="size-3 text-muted-foreground shrink-0" /> : null}
          <span className="font-medium truncate">{d.title || '无标题'}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{owner?.uname || '匿名'}</span>
          <span>·</span>
          <span>{formatRelativeTime(d.docId ? new Date(parseInt(String(d.docId).substring(0, 8), 16) * 1000) : d.updateAt, locale)} 发布</span>
        </div>
      </div>
      <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground gap-0.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-0.5 tabular-nums">
            <MessageSquare className="size-3" />{d.nReply || 0}
          </span>
          <span className="flex items-center gap-0.5 tabular-nums">
            <Eye className="size-3" />{d.views || 0}
          </span>
        </div>
        {lastReplyUser ? (
          <span className="truncate max-w-[140px]" title={`最后回复：${lastReplyUser.uname}`}>
            {formatRelativeTime(d.updateAt, locale)} · {lastReplyUser.uname}
          </span>
        ) : (
          <span>{formatRelativeTime(d.updateAt, locale)}</span>
        )}
      </div>
    </a>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Discussion detail                                                  */
/* ────────────────────────────────────────────────────────────────── */

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
  const examUrls: R = data.examMode?.urls || {};
  const inExamMode = !!data.examMode?.enabled;
  const discussionsBase = examUrls.discussion || bs.urls.discussions;
  const discussionUrl = examUrls.discussionDetail
    ? replaceRouteTokens(examUrls.discussionDetail, { DID: String(ddoc._id || ddoc.docId || '') })
    : replaceRouteTokens(bs.urls.discussionDetail, { DID: String(ddoc._id || ddoc.docId || '') });
  const isOwner = Number(ddoc.owner) === Number(bs.user.id);
  const permissions: R = data.permissions || {};
  const replyPermissions: R = permissions.replies || {};
  const reactions: R = data.reactions || {};
  const did = String(ddoc._id || ddoc.docId || '');
  const canEditDiscussion = permissions.canEditDiscussion ?? isOwner;
  const canLockDiscussion = permissions.canLockDiscussion ?? isOwner;
  const canReply = permissions.canReply ?? bs.user.signedIn;
  const canReact = !!permissions.canReact;

  // Numbering: floor 1 = OP; replies start at floor 2.
  const floorOffset = (page - 1) * 20; // assuming page size 20; adjust if backend differs

  // Quote handler: insert "> @uname wrote:\n> ..." into the bottom reply editor.
  const replyEditorRef = useRef<HTMLTextAreaElement | null>(null);
  function quoteReply(reply: R) {
    const u = getUser(udict, reply.owner);
    const body = String(reply.content || '').split('\n').map((l) => `> ${l}`).join('\n');
    const quote = `\n> @${u?.uname || 'user'} 写道：\n${body}\n\n`;
    // Find the bottom textarea (MarkdownEditor renders a real textarea via name="content")
    const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea[name="content"]');
    const editor = editors[editors.length - 1];
    if (!editor) return;
    editor.value = (editor.value || '') + quote;
    editor.focus();
    editor.scrollTop = editor.scrollHeight;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Draft autosave for the main reply editor (bottom of page).
  const draftKey = `krypton.discussion-draft.${did}`;
  useEffect(() => {
    const interval = setInterval(() => {
      const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea[name="content"]');
      const editor = editors[editors.length - 1];
      if (!editor) return;
      const v = editor.value || '';
      if (v.trim()) {
        try { localStorage.setItem(draftKey, v); } catch { /* quota */ }
      } else {
        try { localStorage.removeItem(draftKey); } catch { /* */ }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [draftKey]);
  // Restore once mounted
  useEffect(() => {
    let saved = '';
    try { saved = localStorage.getItem(draftKey) || ''; } catch { /* */ }
    if (!saved) return;
    requestAnimationFrame(() => {
      const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea[name="content"]');
      const editor = editors[editors.length - 1];
      if (editor && !editor.value) {
        editor.value = saved;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }, [draftKey]);

  // Keyboard shortcuts: R = focus reply editor, E = edit OP (if owner)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') {
        const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea[name="content"]');
        const editor = editors[editors.length - 1];
        if (editor) { editor.focus(); e.preventDefault(); }
      } else if (e.key === 'e' || e.key === 'E') {
        if (canEditDiscussion && !inExamMode) {
          window.location.href = `${discussionUrl}/edit`;
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEditDiscussion, discussionUrl, inExamMode]);

  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <a href={discussionsBase} className="hover:text-primary">讨论</a>
          {!inExamMode && data.vnode?.title ? (
            <>
              <ChevronRight className="size-3" />
              <a
                href={`${bs.urls.discussions}/${vnodeTypeSlug(data.vnode.type)}/${encodeURIComponent(String(data.vnode.id))}`}
                className="hover:text-primary"
              >
                {data.vnode.title}
              </a>
            </>
          ) : null}
          <ChevronRight className="size-3" />
        </div>
        <h1 className="mt-1 text-2xl font-bold flex items-center gap-2 flex-wrap">
          {ddoc.pin ? <Pin className="size-5 text-amber-500" /> : null}
          {ddoc.highlight ? <Star className="size-5 text-amber-500" /> : null}
          {ddoc.title || '讨论'}
        </h1>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <Avatar className="size-5">
            {owner?.avatarUrl ? <AvatarImage src={String(owner.avatarUrl)} alt={String(owner.uname || '')} /> : null}
            <AvatarFallback className="text-[8px]">{makeInitials(owner?.uname || '?')}</AvatarFallback>
          </Avatar>
          <span>{owner?.uname || '匿名'}</span>
          <span>·</span>
          <span>{formatRelativeTime(ddoc.updateAt, locale)}</span>
          <span>·</span>
          <span className="flex items-center gap-1"><Eye className="size-3" />{ddoc.views || 0} 浏览</span>
          <span>·</span>
          <span className="flex items-center gap-1"><MessageSquare className="size-3" />{drcount} 回复</span>
          {ddoc.lock ? <Badge variant="outline" className="ml-1">已锁定</Badge> : null}
        </div>
      </div>

      {/* Floor jump bar — visible when many replies */}
      {drcount > 5 ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-2.5 text-xs">
            <Hash className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">跳楼：</span>
            <input
              type="number"
              min={1}
              max={drcount + 1}
              placeholder="1"
              className="w-20 rounded border bg-background px-2 py-1 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = parseInt((e.target as HTMLInputElement).value || '0', 10);
                  if (v >= 1) {
                    const targetPage = Math.max(1, Math.ceil(v / 20));
                    if (targetPage !== page) {
                      window.location.href = `${discussionUrl}?page=${targetPage}#floor-${v}`;
                    } else {
                      document.getElementById(`floor-${v}`)?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }
                }
              }}
            />
            <span className="text-muted-foreground">/ {drcount + 1}</span>
            <a href={`${discussionUrl}?page=${pcount}#bottom`} className="ml-auto text-primary hover:underline flex items-center gap-1">
              <ArrowDown className="size-3" />跳到最新
            </a>
          </CardContent>
        </Card>
      ) : null}

      {/* OP card */}
      <Card id="floor-1">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono">#1 (楼主)</span>
            {!inExamMode ? <a
              href={`${discussionUrl}/raw?history=1`}
              className="flex items-center gap-1 hover:text-primary"
              title="编辑历史"
            >
              <History className="size-3" />
              历史
            </a> : null}
          </div>
          {ddoc.content ? (
            <MentionedMarkdown content={ddoc.content} />
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
            {canEditDiscussion && !inExamMode ? (
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
            {permissions.canDeleteDiscussion && !inExamMode ? (
              <Button asChild variant="ghost" size="sm" className="text-destructive">
                <a href={`${discussionUrl}/edit`}>
                  <Trash2 className="mr-1 size-3.5" />删除
                </a>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Replies */}
      {drdocs.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{drcount} 条回复</h2>
          {drdocs.map((reply, i) => {
            const rOwner = getUser(udict, reply.owner);
            const tailReplies: R[] = reply.reply || [];
            const rid = String(reply._id || reply.docId || i);
            const perms = replyPermissions[rid] || {};
            const floor = floorOffset + i + 2; // OP is #1
            return (
              <Card key={rid} id={`floor-${floor}`}>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Avatar className="size-6">
                        {rOwner?.avatarUrl ? <AvatarImage src={String(rOwner.avatarUrl)} alt={String(rOwner.uname || '')} /> : null}
                        <AvatarFallback className="text-[8px]">{makeInitials(rOwner?.uname || '?')}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{rOwner?.uname || '匿名'}</span>
                      <span className="font-mono text-xs text-muted-foreground">#{floor}</span>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(reply.updateAt || reply._id, locale)}</span>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {canReply ? (
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => quoteReply(reply)}>
                          <Quote className="size-3" />引用
                        </Button>
                      ) : null}
                      {!inExamMode ? <a
                        href={`${discussionUrl}/raw?drid=${rid}&history=1`}
                        className="inline-flex items-center gap-1 rounded h-7 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <History className="size-3" />历史
                      </a> : null}
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
                  {reply.content ? <MentionedMarkdown content={reply.content} /> : null}
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
                            <MentionedMarkdown content={tail.content || ''} />
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
                        name="tailContent"
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

      {/* Bottom reply editor */}
      <div id="bottom" />
      {canReply ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>发表回复</span>
              <span className="text-xs font-normal text-muted-foreground flex items-center gap-2">
                <span className="hidden sm:inline">快捷键 <kbd className="rounded border bg-muted px-1 text-[10px]">R</kbd> 回复</span>
                <AutosaveIndicator draftKey={draftKey} />
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form method="post" className="space-y-3" onSubmit={() => {
              try { localStorage.removeItem(draftKey); } catch { /* */ }
            }}>
              <input type="hidden" name="operation" value="reply" />
              <MarkdownEditor name="content" value="" minHeight={220} />
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => {
                  if (window.confirm('清除已保存的草稿？')) {
                    try { localStorage.removeItem(draftKey); } catch { /* */ }
                    const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea[name="content"]');
                    const editor = editors[editors.length - 1];
                    if (editor) { editor.value = ''; editor.dispatchEvent(new Event('input', { bubbles: true })); }
                  }
                }}>清除草稿</Button>
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

/** Renders markdown with @uname mentions automatically linkified. */
function MentionedMarkdown({ content }: { content: string | Record<string, string> }) {
  // Hydro user profiles are at /user/uid; resolving uname → uid is server-side.
  // Best we can do client-side: link @uname to /user/uname, which old UI also supported.
  const transformed = useMemo(() => {
    const transform = (s: string) => s.replace(
      /(^|[^\w])@([A-Za-z0-9_一-龥][A-Za-z0-9_一-龥-]{0,30})/g,
      (_, pre, name) => `${pre}[@${name}](/user/${encodeURIComponent(name)})`,
    );
    if (typeof content === 'string') return transform(content);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(content || {})) {
      out[k] = typeof v === 'string' ? transform(v) : (v as string);
    }
    return out;
  }, [content]);
  return <MarkdownView content={transformed} className="prose prose-sm dark:prose-invert max-w-none" />;
}

function AutosaveIndicator({ draftKey }: { draftKey: string }) {
  const [hasSaved, setHasSaved] = useState(false);
  useEffect(() => {
    const check = () => {
      try {
        const v = localStorage.getItem(draftKey);
        setHasSaved(!!v && v.trim().length > 0);
      } catch { /* */ }
    };
    check();
    const t = setInterval(check, 2500);
    return () => clearInterval(t);
  }, [draftKey]);
  if (!hasSaved) return null;
  return (
    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
      <Clock className="size-3" />已自动保存草稿
    </span>
  );
}
