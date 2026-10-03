/**
 * Discussion list + detail pages.
 *
 * Keeps the Hydro discussion behaviors the first port added: vnode sidebar,
 * sort tabs, search, last-reply column, reply numbering, history link,
 * draft autosave, and keyboard shortcuts.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
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
  Send,
  Smile,
  Star,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Kbd } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SearchInput } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import { confirmDialog, confirmFormSubmit } from '@/components/ui/dialog';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';

interface DiscussionDoc {
  _id?: unknown;
  docId?: unknown;
  title?: string;
  content?: string | Record<string, string>;
  owner?: string | number;
  updateAt?: unknown;
  views?: number;
  nReply?: number;
  pin?: boolean;
  highlight?: boolean;
  lock?: boolean;
  react?: Record<string, unknown>;
  lastRUid?: string | number;
}

interface DiscussionTailReplyDoc {
  _id?: unknown;
  owner?: string | number;
  content?: string;
  updateAt?: unknown;
}

interface DiscussionReplyDoc {
  _id?: unknown;
  docId?: unknown;
  owner?: string | number;
  content?: string;
  updateAt?: unknown;
  react?: Record<string, unknown>;
  reply?: DiscussionTailReplyDoc[];
}

interface TailReplyPermissions {
  canEdit?: boolean;
  canDelete?: boolean;
}

interface ReplyPermissions extends TailReplyPermissions {
  tail?: Record<string, TailReplyPermissions | undefined>;
}

interface DiscussionPermissions {
  canEditDiscussion?: boolean;
  canLockDiscussion?: boolean;
  canReply?: boolean;
  canReact?: boolean;
  canDeleteDiscussion?: boolean;
  replies?: Record<string, ReplyPermissions | undefined>;
}

interface DiscussionExamUrls {
  discussion?: string;
  discussionDetail?: string;
  discussionCreate?: string;
}

/** A `TYPE_DISCUSSION_NODE` document — see the NodeList doc comment below. */
interface VNodeDoc {
  _id?: unknown;
  docId?: string;
  content?: string;
  count?: number;
}

type VNodeCollection = VNodeDoc[] | Record<string, VNodeDoc[] | Record<string, VNodeDoc>>;

interface DiscussionsPageData {
  all?: unknown;
  canViewHidden?: unknown;
  page_name?: unknown;
  dcount?: number;
  ddoc?: DiscussionDoc;
  ddocs?: DiscussionDoc[];
  dpcount?: unknown;
  drcount?: unknown;
  drdocs?: DiscussionReplyDoc[];
  dsdoc?: { star?: boolean };
  examMode?: {
    enabled?: boolean;
    urls?: DiscussionExamUrls;
  };
  page?: unknown;
  pcount?: unknown;
  permissions?: DiscussionPermissions;
  reactions?: Record<string, Record<string, unknown> | undefined>;
  udict?: Record<string, GenericUserDoc>;
  vnode?: {
    id?: string | number;
    title?: string;
    type?: string | number;
  };
  vnodes?: VNodeCollection;
}

function withDiscussQuery(baseUrl: string, params: Record<string, string | undefined>) {
  const [path, query = ''] = baseUrl.split('?');
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
    else search.delete(key);
  }
  const next = search.toString();
  return next ? `${path}?${next}` : path;
}

/** Hydro `pagination.reply` default. Floor 1 is the OP; each page holds this many replies. */
const DISCUSSION_REPLY_PAGE_SIZE = 50;

type SortKey = 'updateAt' | 'docId' | 'views' | 'nReply';

function updateAtMillis(raw: unknown): number {
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** Rank used by the list tabs. `docId` uses the same ObjectId timestamp prefix as the publish time. */
function discussionSortRank(doc: DiscussionDoc, key: SortKey): number {
  if (key === 'docId') {
    const seconds = Number.parseInt(String(doc.docId ?? '').slice(0, 8), 16);
    return Number.isNaN(seconds) ? 0 : seconds;
  }
  if (key === 'updateAt') return updateAtMillis(doc.updateAt);
  const value = Number(doc[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function replyPageForFloor(floor: number): number {
  if (floor <= 1) return 1;
  return Math.floor((floor - 2) / DISCUSSION_REPLY_PAGE_SIZE) + 1;
}

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? (udict[String(uid)] ?? null) : null;
}

function ReactionBar({
  react,
  status,
  nodeType,
  id,
  canReact,
}: {
  react?: Record<string, unknown>;
  status?: Record<string, unknown>;
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
            <Button type="submit" variant={active ? 'soft' : 'secondary'} size="sm" disabled={!canReact}>
              <span>{emoji}</span>
              <span className="tabular">{String(count)}</span>
            </Button>
          </form>
        );
      })}
      {canReact ? (
        <div className="flex flex-wrap gap-1">
          {quick
            .filter((emoji) => !react?.[emoji])
            .map((emoji) => (
              <form key={emoji} method="post">
                <input type="hidden" name="operation" value="reaction" />
                <input type="hidden" name="nodeType" value={nodeType} />
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="emoji" value={emoji} />
                <Button type="submit" variant="ghost" size="sm">
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
  const data = bs.page.data as DiscussionsPageData;
  const ddocs: DiscussionDoc[] = data.ddocs || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const page = Number(data.page) || 1;
  const dpcount = Number(data.dpcount) || 1;
  const vnode: { title?: string; id?: string | number } = data.vnode || {};
  const vnodes: VNodeCollection = data.vnodes || {}; // grouped nodes by category
  const locale = bs.locale;
  const examUrls: DiscussionExamUrls = data.examMode?.urls || {};
  const inExamMode = !!data.examMode?.enabled;
  const discussionsBase =
    examUrls.discussion || (data.page_name === 'discussion_node' ? window.location.pathname : bs.urls.discussions);
  const discussionDetailRoute = examUrls.discussionDetail || bs.urls.discussionDetail;
  const createUrl =
    examUrls.discussionCreate || (data.page_name === 'discussion_node' ? `${discussionsBase}/create` : '');
  const canViewHidden = data.canViewHidden === true;
  const showingHidden = !!data.all;
  const discussionsListUrl = withDiscussQuery(discussionsBase, { all: showingHidden ? '1' : undefined });

  const [sortKey, setSortKey] = useState<SortKey>('updateAt');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = !q ? ddocs : ddocs.filter((d) => (d.title || '').toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      const pinOrder = Number(Boolean(b.pin)) - Number(Boolean(a.pin));
      if (pinOrder !== 0) return pinOrder;
      return discussionSortRank(b, sortKey) - discussionSortRank(a, sortKey);
    });
  }, [ddocs, sortKey, search]);

  return (
    <Page width="wide">
      <PageHeader
        title={vnode.title ? `讨论 · ${vnode.title}` : '讨论'}
        description={`${data.dcount || ddocs.length} 条讨论`}
        actions={
          createUrl ? (
            <Button asChild variant="primary" className="shrink-0">
              <a href={createUrl}>发起讨论</a>
            </Button>
          ) : undefined
        }
      />

      <div className={inExamMode ? 'flex flex-col gap-4' : 'flex flex-col gap-4 md:flex-row md:items-start'}>
        {!inExamMode ? (
          <aside className="min-w-0 md:w-60 md:shrink-0">
            <div className="md:hidden">
              <NodeList layout="chips" vnodes={vnodes} currentId={vnode?.id} discussionsUrl={bs.urls.discussions} />
            </div>
            <Panel
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Filter className="size-3.5" />
                  分类
                </span>
              }
              flush
              className="hidden md:block"
            >
              <NodeList layout="list" vnodes={vnodes} currentId={vnode?.id} discussionsUrl={bs.urls.discussions} />
            </Panel>
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Toolbar
            end={
              canViewHidden ? (
                <label className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
                  <Checkbox
                    size="sm"
                    checked={showingHidden}
                    onCheckedChange={(checked) => {
                      window.location.href = withDiscussQuery(discussionsBase, { all: checked ? '1' : undefined });
                    }}
                  />
                  显示隐藏讨论
                </label>
              ) : undefined
            }
          >
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:w-72"
              placeholder="搜索标题…"
            />
            <div className="w-full min-w-0 overflow-x-auto sm:w-auto">
              <MiniTabs
                size="sm"
                className="min-w-max"
                value={sortKey}
                onValueChange={(v) => setSortKey(v as SortKey)}
                items={[
                  { value: 'updateAt', label: '最新回复' },
                  { value: 'docId', label: '最新发布' },
                  { value: 'nReply', label: '回复数' },
                  { value: 'views', label: '浏览数' },
                ]}
              />
            </div>
          </Toolbar>

          {filtered.length === 0 ? (
            <Panel>
              <EmptyState icon={<MessageSquare />} title={ddocs.length === 0 ? '暂无讨论' : '没有匹配的讨论'} compact />
            </Panel>
          ) : (
            <Panel flush>
              <div className="divide-y divide-line-subtle">
                {filtered.map((d) => (
                  <DiscussionRow key={String(d._id)} d={d} udict={udict} locale={locale} discussionsUrl={discussionDetailRoute} />
                ))}
              </div>
            </Panel>
          )}

          <Pagination current={page} total={dpcount} baseUrl={discussionsListUrl} />
        </div>
      </div>
    </Page>
  );
}

/**
 * `data.vnodes` from hydrooj's discussion handler is a flat array of
 * `TYPE_DISCUSSION_NODE` documents (`document.getNodes`). Each doc has
 * `docId` (the board name), `content`, and no `title`. Treating the array
 * as a record rendered index keys and the label "undefined".
 */
/**
 * Map a hydrooj numeric docType (from `getVnode`) to the URL slug expected
 * by `/discuss/:type/:name`. Must mirror `typeMapper` in
 * `packages/hydrooj/src/handler/discussion.ts`.
 */
function vnodeTypeSlug(type: number | string | undefined): string {
  switch (Number(type)) {
    case 10:
      return 'problem';
    case 20:
      return 'node';
    case 30:
      return 'contest';
    case 40:
      return 'training';
    default:
      return 'node';
  }
}

function nodeListItems(vnodes: VNodeCollection | null | undefined): VNodeDoc[] {
  if (Array.isArray(vnodes)) return vnodes;
  const items: VNodeDoc[] = [];
  if (vnodes && typeof vnodes === 'object') {
    // Legacy/alternate shapes: { docType: [vnode, ...] } or { docType: { id: vnode } }
    for (const v of Object.values(vnodes)) {
      if (Array.isArray(v)) items.push(...v);
      else if (v && typeof v === 'object') items.push(...Object.values(v));
    }
  }
  return items;
}

function NodeList({
  vnodes,
  currentId,
  discussionsUrl,
  layout = 'list',
}: {
  vnodes: VNodeCollection | null | undefined;
  currentId?: string | number;
  discussionsUrl: string;
  layout?: 'list' | 'chips';
}) {
  const items = nodeListItems(vnodes);

  if (layout === 'chips') {
    const chipClass = (active: boolean) =>
      `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs ${
        active ? 'bg-surface-active font-medium text-fg' : 'bg-surface text-fg hover:bg-surface-hover'
      }`;
    return (
      <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain" aria-label="讨论分类">
        <a href={discussionsUrl} className={chipClass(!currentId)}>
          全部讨论
        </a>
        {items.slice(0, 60).map((n) => {
          const slugName = n.docId ?? n._id;
          const label = n.docId ?? n.content ?? String(n._id ?? '');
          const active = String(currentId) === String(slugName);
          return (
            <a
              key={String(n._id ?? slugName)}
              href={`${discussionsUrl}/node/${encodeURIComponent(String(slugName))}`}
              className={chipClass(active)}
              title={label}
            >
              <span>{label}</span>
              {n.count ? <span className="text-2xs tabular text-fg-subtle">{n.count}</span> : null}
            </a>
          );
        })}
      </div>
    );
  }

  const allDiscussionsLink = (
    <a
      href={discussionsUrl}
      className={`block border-b border-line px-3 py-2 text-xs font-medium ${!currentId ? 'bg-surface-active text-fg' : 'hover:bg-surface-hover'}`}
    >
      全部讨论
    </a>
  );

  if (items.length === 0) return allDiscussionsLink;

  return (
    <div>
      {allDiscussionsLink}
      <p className="px-3 py-1.5 text-2xs text-fg-subtle">板块</p>
      <div>
        {items.slice(0, 60).map((n) => {
          // `docId` is the board name; `_id` is the ObjectId. The route
          // accepts either. Prefer `docId` because it stays stable across imports.
          const slugName = n.docId ?? n._id;
          const label = n.docId ?? n.content ?? String(n._id ?? '');
          const active = String(currentId) === String(slugName);
          return (
            <a
              key={String(n._id ?? slugName)}
              href={`${discussionsUrl}/node/${encodeURIComponent(String(slugName))}`}
              className={`flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs ${active ? 'bg-surface-active font-medium text-fg' : 'hover:bg-surface-hover'}`}
              title={label}
            >
              <span className="truncate">{label}</span>
              {n.count ? <span className="shrink-0 text-2xs tabular text-fg-subtle">{n.count}</span> : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function DiscussionRow({
  d,
  udict,
  locale,
  discussionsUrl,
}: {
  d: DiscussionDoc;
  udict: Record<string, GenericUserDoc>;
  locale: string;
  discussionsUrl: string;
}) {
  const owner = getUser(udict, d.owner);
  const lastReplyUser = d.lastRUid ? getUser(udict, d.lastRUid) : null;
  const url = replaceRouteTokens(discussionsUrl, { DID: String(d._id) });
  return (
    <a href={url} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover">
      <Avatar className="mt-0.5 size-8 shrink-0">
        {owner?.avatarUrl ? <AvatarImage src={String(owner.avatarUrl)} alt={String(owner.uname || '')} /> : null}
        <AvatarFallback className="text-2xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {d.pin ? <Pin className="size-3 shrink-0 text-warning-fg" /> : null}
          {d.highlight ? <Star className="size-3 shrink-0 text-warning-fg" /> : null}
          {d.lock ? <Lock className="size-3 shrink-0 text-fg-subtle" /> : null}
          <span className="truncate font-medium text-fg">{d.title || '无标题'}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          <span>{owner?.uname || '匿名'}</span>
          <span>·</span>
          <span>{formatRelativeTime(d.docId ? new Date(Number.parseInt(String(d.docId).substring(0, 8), 16) * 1000) : d.updateAt, locale)} 发布</span>
        </div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 text-xs text-fg-subtle sm:flex">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-0.5 tabular">
            <MessageSquare className="size-3" />
            {d.nReply || 0}
          </span>
          <span className="flex items-center gap-0.5 tabular">
            <Eye className="size-3" />
            {d.views || 0}
          </span>
        </div>
        {lastReplyUser ? (
          <span className="max-w-36 truncate" title={`最后回复：${lastReplyUser.uname}`}>
            {formatRelativeTime(d.updateAt, locale)} · {lastReplyUser.uname}
          </span>
        ) : (
          <span>{formatRelativeTime(d.updateAt, locale)}</span>
        )}
      </div>
    </a>
  );
}

export function DiscussionDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as DiscussionsPageData;
  const ddoc: DiscussionDoc = data.ddoc || {};
  const drdocs: DiscussionReplyDoc[] = data.drdocs || [];
  const page = Number(data.page) || 1;
  const pcount = Number(data.pcount) || 1;
  const drcount = Number(data.drcount) || 1;
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const owner = getUser(udict, ddoc.owner);
  const locale = bs.locale;
  const examUrls: DiscussionExamUrls = data.examMode?.urls || {};
  const inExamMode = !!data.examMode?.enabled;
  const discussionsBase = examUrls.discussion || bs.urls.discussions;
  const discussionUrl = examUrls.discussionDetail
    ? replaceRouteTokens(examUrls.discussionDetail, { DID: String(ddoc._id || ddoc.docId || '') })
    : replaceRouteTokens(bs.urls.discussionDetail, { DID: String(ddoc._id || ddoc.docId || '') });
  const isOwner = Number(ddoc.owner) === Number(bs.user.id);
  const permissions: DiscussionPermissions = data.permissions || {};
  const replyPermissions: Record<string, ReplyPermissions | undefined> = permissions.replies || {};
  const reactions: Record<string, Record<string, unknown> | undefined> = data.reactions || {};
  const did = String(ddoc._id || ddoc.docId || '');
  const canEditDiscussion = permissions.canEditDiscussion ?? isOwner;
  const canLockDiscussion = permissions.canLockDiscussion ?? isOwner;
  const canReply = permissions.canReply ?? bs.user.signedIn;
  const canReact = !!permissions.canReact;

  // Floor 1 is the OP. Replies start at floor 2, DISCUSSION_REPLY_PAGE_SIZE per page.
  const floorOffset = (page - 1) * DISCUSSION_REPLY_PAGE_SIZE;

  // Quote handler: insert "> @uname wrote:\n> ..." into the bottom reply editor.
  function quoteReply(reply: DiscussionReplyDoc) {
    const u = getUser(udict, reply.owner);
    const body = String(reply.content || '')
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
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
        try {
          localStorage.setItem(draftKey, v);
        } catch {
          /* quota */
        }
      } else {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* */
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [draftKey]);
  // Restore once mounted
  useEffect(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(draftKey) || '';
    } catch {
      /* */
    }
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
        if (editor) {
          editor.focus();
          e.preventDefault();
        }
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

  const crumbs: { label: string; href?: string }[] = [{ label: '讨论', href: discussionsBase }];
  if (!inExamMode && data.vnode?.title) {
    crumbs.push({
      label: data.vnode.title,
      href: `${bs.urls.discussions}/${vnodeTypeSlug(data.vnode.type)}/${encodeURIComponent(String(data.vnode.id))}`,
    });
  }
  crumbs.push({ label: ddoc.title || '讨论' });

  return (
    <Page width="prose">
      <PageHeader
        breadcrumb={<Breadcrumb items={crumbs} />}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {ddoc.pin ? <Pin className="size-5 shrink-0 text-warning-fg" /> : null}
            {ddoc.highlight ? <Star className="size-5 shrink-0 text-warning-fg" /> : null}
            <span className="min-w-0 break-words">{ddoc.title || '讨论'}</span>
          </span>
        }
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Avatar className="size-5">
                {owner?.avatarUrl ? <AvatarImage src={String(owner.avatarUrl)} alt={String(owner.uname || '')} /> : null}
                <AvatarFallback className="text-2xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
              </Avatar>
              <span>{owner?.uname || '匿名'}</span>
            </span>
            <span>{formatRelativeTime(ddoc.updateAt, locale)}</span>
            <span className="inline-flex items-center gap-1 tabular">
              <Eye className="size-3" />
              {ddoc.views || 0} 浏览
            </span>
            <span className="inline-flex items-center gap-1 tabular">
              <MessageSquare className="size-3" />
              {drcount} 回复
            </span>
            {ddoc.lock ? (
              <Badge variant="outline" size="sm">
                已锁定
              </Badge>
            ) : null}
          </>
        }
      />

      {drcount > 5 ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <Hash className="size-3.5 shrink-0" />
            <span>跳楼：</span>
            <Input
              type="number"
              size="sm"
              min={1}
              max={drcount + 1}
              placeholder="1"
              className="w-20"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const v = Number.parseInt((event.target as HTMLInputElement).value || '0', 10);
                  if (v >= 1) {
                    const targetPage = replyPageForFloor(v);
                    if (targetPage !== page) {
                      window.location.href = `${discussionUrl}?page=${targetPage}#floor-${v}`;
                    } else {
                      document.getElementById(`floor-${v}`)?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }
                }
              }}
            />
            <span className="tabular">/ {drcount + 1}</span>
            <a href={`${discussionUrl}?page=${pcount}#bottom`} className="ml-auto inline-flex items-center gap-1 text-brand-fg hover:underline">
              <ArrowDown className="size-3" />
              跳到最新
            </a>
          </div>
        </Panel>
      ) : null}

      <div id="floor-1">
        <Panel>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-subtle">
              <span className="font-mono tabular">#1 (楼主)</span>
              {!inExamMode ? (
                <a href={`${discussionUrl}/raw?history=1`} className="inline-flex items-center gap-1 hover:text-brand-fg" title="编辑历史">
                  <History className="size-3" />
                  历史
                </a>
              ) : null}
            </div>
            {ddoc.content ? <MentionedMarkdown content={ddoc.content} /> : <p className="text-sm text-fg-muted">无内容</p>}
            <ReactionBar react={ddoc.react} status={reactions[did]} nodeType="did" id={did} canReact={canReact} />
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              {bs.user.signedIn && (
                <form method="post">
                  <input type="hidden" name="operation" value="star" />
                  <input type="hidden" name="star" value={data.dsdoc?.star ? 'false' : 'true'} />
                  <Button type="submit" variant="secondary" size="sm">
                    <Star />
                    {data.dsdoc?.star ? '取消收藏' : '收藏'}
                  </Button>
                </form>
              )}
              {canLockDiscussion ? (
                <form method="post">
                  <input type="hidden" name="operation" value="set_lock" />
                  {!ddoc.lock && <input type="hidden" name="lock" value="true" />}
                  <Button type="submit" variant="secondary" size="sm">
                    <Lock />
                    {ddoc.lock ? '解除锁定' : '锁定'}
                  </Button>
                </form>
              ) : null}
              {canEditDiscussion && !inExamMode ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={`${discussionUrl}/edit`}>
                    <Edit />
                    编辑
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <a href="/wiki/help#contact">
                  <Smile />
                  举报
                </a>
              </Button>
              {permissions.canDeleteDiscussion && !inExamMode ? (
                <Button asChild variant="danger-soft" size="sm">
                  <a href={`${discussionUrl}/edit`}>
                    <Trash2 />
                    删除
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>

      {drdocs.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg-subtle">{drcount} 条回复</h2>
          {drdocs.map((reply, i) => {
            const rOwner = getUser(udict, reply.owner);
            const tailReplies: DiscussionTailReplyDoc[] = reply.reply || [];
            const rid = String(reply._id || reply.docId || i);
            const perms: ReplyPermissions = replyPermissions[rid] || {};
            const floor = floorOffset + i + 2; // OP is #1
            return (
              <div key={rid} id={`floor-${floor}`}>
                <Panel>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm sm:mr-auto">
                        <Avatar className="size-6 shrink-0">
                          {rOwner?.avatarUrl ? <AvatarImage src={String(rOwner.avatarUrl)} alt={String(rOwner.uname || '')} /> : null}
                          <AvatarFallback className="text-2xs">{makeInitials(rOwner?.uname || '?')}</AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium text-fg">{rOwner?.uname || '匿名'}</span>
                        <span className="font-mono text-xs tabular text-fg-subtle">#{floor}</span>
                        <span className="text-xs text-fg-subtle">{formatRelativeTime(reply.updateAt || reply._id, locale)}</span>
                      </div>
                      {canReply ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => quoteReply(reply)}>
                          <Quote />
                          引用
                        </Button>
                      ) : null}
                      {!inExamMode ? (
                        <a
                          href={`${discussionUrl}/raw?drid=${rid}&history=1`}
                          className="inline-flex h-(--control-sm) items-center gap-1.5 rounded-md px-2.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
                        >
                          <History className="size-3.5" />
                          历史
                        </a>
                      ) : null}
                      {perms.canDelete ? (
                        <form
                          method="post"
                          onSubmit={(event) => {
                            void confirmFormSubmit(event, '确定删除这条回复？', { destructive: true });
                          }}
                        >
                          <input type="hidden" name="operation" value="delete_reply" />
                          <input type="hidden" name="drid" value={rid} />
                          <Button type="submit" variant="danger-soft" size="sm">
                            <Trash2 />
                            删除
                          </Button>
                        </form>
                      ) : null}
                      {perms.canEdit ? (
                        <details className="contents">
                          <summary className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} list-none cursor-pointer`}>
                            <Edit />
                            编辑
                          </summary>
                          <div className="mt-2 w-full rounded-lg bg-surface-sunken p-4 sm:basis-full">
                            <form method="post" className="flex flex-col gap-3">
                              <input type="hidden" name="operation" value="edit_reply" />
                              <input type="hidden" name="drid" value={rid} />
                              <MarkdownEditor name="content" value={reply.content || ''} minHeight={160} />
                              <div className="flex justify-end">
                                <Button type="submit" variant="secondary" size="sm">
                                  保存
                                </Button>
                              </div>
                            </form>
                          </div>
                        </details>
                      ) : null}
                    </div>
                    {reply.content ? <MentionedMarkdown content={reply.content} /> : null}
                    <ReactionBar react={reply.react} status={reactions[rid]} nodeType="drid" id={rid} canReact={canReact} />
                    {tailReplies.length > 0 && (
                      <div className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-4">
                        {tailReplies.map((tail) => {
                          const tailOwner = getUser(udict, tail.owner);
                          const tid = String(tail._id);
                          const tailPerms: TailReplyPermissions = perms.tail?.[tid] || {};
                          return (
                            <div key={tid} className="flex flex-col gap-2 border-b border-line-subtle pb-3 last:border-b-0 last:pb-0">
                              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-fg-subtle sm:mr-auto">
                                  <span className="truncate font-medium text-fg">{tailOwner?.uname || `UID ${tail.owner}`}</span>
                                  <span>{formatRelativeTime(tail.updateAt || tail._id, locale)}</span>
                                </div>
                                {tailPerms.canDelete ? (
                                  <form
                                    method="post"
                                    onSubmit={(event) => {
                                      void confirmFormSubmit(event, '确定删除这条楼中楼回复？', { destructive: true });
                                    }}
                                  >
                                    <input type="hidden" name="operation" value="delete_tail_reply" />
                                    <input type="hidden" name="drid" value={rid} />
                                    <input type="hidden" name="drrid" value={tid} />
                                    <Button type="submit" variant="danger-soft" size="sm">
                                      删除
                                    </Button>
                                  </form>
                                ) : null}
                                {tailPerms.canEdit ? (
                                  <details className="contents">
                                    <summary className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} list-none cursor-pointer`}>
                                      <Edit />
                                      编辑
                                    </summary>
                                    <div className="mt-2 w-full rounded-lg bg-surface-sunken p-4 sm:basis-full">
                                      <form method="post" className="flex flex-col gap-3">
                                        <input type="hidden" name="operation" value="edit_tail_reply" />
                                        <input type="hidden" name="drid" value={rid} />
                                        <input type="hidden" name="drrid" value={tid} />
                                        <MarkdownEditor name="content" value={tail.content || ''} minHeight={140} />
                                        <div className="flex justify-end">
                                          <Button type="submit" variant="secondary" size="sm">
                                            保存
                                          </Button>
                                        </div>
                                      </form>
                                    </div>
                                  </details>
                                ) : null}
                              </div>
                              <MentionedMarkdown content={tail.content || ''} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {canReply && !ddoc.lock ? (
                      <form method="post" className="flex flex-col gap-2">
                        <input type="hidden" name="operation" value="tail_reply" />
                        <input type="hidden" name="drid" value={rid} />
                        <Textarea name="content" rows={2} placeholder={`回复 ${rOwner?.uname || '该用户'}…`} />
                        <div className="flex justify-end">
                          <Button type="submit" variant="secondary" size="sm">
                            <Send />
                            回复
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                </Panel>
              </div>
            );
          })}
        </div>
      ) : null}

      <Pagination current={page} total={pcount} baseUrl={discussionUrl} />

      <div id="bottom" />
      {canReply ? (
        <Panel
          title="发表回复"
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="hidden sm:inline">
                快捷键 <Kbd>R</Kbd> 回复
              </span>
              <AutosaveIndicator draftKey={draftKey} />
            </span>
          }
        >
          <form
            method="post"
            className="flex flex-col gap-3"
            onSubmit={() => {
              try {
                localStorage.removeItem(draftKey);
              } catch {
                /* */
              }
            }}
          >
            <input type="hidden" name="operation" value="reply" />
            <MarkdownEditor name="content" value="" minHeight={180} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (await confirmDialog('清除已保存的草稿？')) {
                    try {
                      localStorage.removeItem(draftKey);
                    } catch {
                      /* */
                    }
                    const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea[name="content"]');
                    const editor = editors[editors.length - 1];
                    if (editor) {
                      editor.value = '';
                      editor.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                  }
                }}
              >
                清除草稿
              </Button>
              <Button type="submit" variant="primary" disabled={ddoc.lock}>
                <Send />
                {ddoc.lock ? '讨论已锁定' : '发表回复'}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}
    </Page>
  );
}

/** Renders markdown with @uname mentions automatically linkified. */
function MentionedMarkdown({ content }: { content: string | Record<string, string> }) {
  // Hydro user profiles are at /user/uid; resolving uname → uid is server-side.
  // Best we can do client-side: link @uname to /user/uname, which old UI also supported.
  const transformed = useMemo(() => {
    const transform = (s: string) =>
      s.replace(
        /(^|\W)@([A-Za-z0-9_\u4E00-\u9FA5][A-Za-z0-9_\u4E00-\u9FA5-]{0,30})/g,
        (_, pre, name) => `${pre}[@${name}](/user/${encodeURIComponent(name)})`,
      );
    if (typeof content === 'string') return transform(content);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(content || {})) {
      out[k] = typeof v === 'string' ? transform(v) : (v as string);
    }
    return out;
  }, [content]);
  return <MarkdownView content={transformed} className="krypton-prose" />;
}

function AutosaveIndicator({ draftKey }: { draftKey: string }) {
  const [hasSaved, setHasSaved] = useState(false);
  useEffect(() => {
    const check = () => {
      try {
        const v = localStorage.getItem(draftKey);
        setHasSaved(!!v && v.trim().length > 0);
      } catch {
        /* */
      }
    };
    check();
    const t = setInterval(check, 2500);
    return () => clearInterval(t);
  }, [draftKey]);
  if (!hasSaved) return null;
  return (
    <span className="inline-flex items-center gap-1 text-success-fg">
      <Clock className="size-3" />
      已自动保存草稿
    </span>
  );
}
