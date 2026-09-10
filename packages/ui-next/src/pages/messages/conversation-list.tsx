/**
 * Conversation sidebar for /home/messages.
 *
 * Search is the header. Rows are buttons; the parent owns ArrowUp/Down.
 * Pin is a sibling control so it does not nest a button inside the row.
 */

import type { JSX, ReactNode, Ref } from 'react';
import { Mail, Pin, Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import { formatRelativeTime, makeInitials } from '@/lib/format';
import { getMessagePreview, lastMessage, objectIdDate } from './parse';
import { isUnseenIncoming } from './seen';
import type { Conv } from './types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const regex = new RegExp(`(${escapeRegExp(needle)})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  const lower = needle.toLowerCase();
  return parts.map((part, index) => {
    if (part.toLowerCase() === lower) {
      return (
        <mark key={index} className="rounded-[2px] bg-primary/20 text-inherit not-italic">
          {part}
        </mark>
      );
    }
    return part;
  });
}

function countUnseenIncoming(conv: Conv, selfUid: number, seen: Set<string>): number {
  let count = 0;
  for (const message of conv.messages) {
    if (isUnseenIncoming(message, selfUid, seen)) count += 1;
  }
  return count;
}

function ConversationRow({
  conv,
  selected,
  pinned,
  selfUid,
  seen,
  search,
  locale,
  onSelect,
  onTogglePin,
}: {
  conv: Conv;
  selected: boolean;
  pinned: boolean;
  selfUid: number;
  seen: Set<string>;
  search: string;
  locale: string;
  onSelect: (uid: number) => void;
  onTogglePin: (uid: number) => void;
}): JSX.Element {
  const name = conv.udoc.uname || `UID ${conv.uid}`;
  const last = lastMessage(conv.messages);
  const lastAt = last ? objectIdDate(last._id) : null;
  const preview = last ? getMessagePreview(last) : '';
  const unread = countUnseenIncoming(conv, selfUid, seen);
  const hasUnread = unread > 0;

  return (
    <div
      className={cn(
        'group flex min-w-0 items-stretch overflow-hidden rounded-lg transition-colors duration-150 motion-reduce:transition-none',
        selected ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(conv.uid)}
        className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Avatar className="size-8 shrink-0">
          {conv.udoc.avatarUrl ? <AvatarImage src={String(conv.udoc.avatarUrl)} alt={name} /> : null}
          <AvatarFallback className="text-[10px]">{makeInitials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p className={cn('min-w-0 flex-1 truncate text-sm', hasUnread ? 'font-semibold' : 'font-medium')}>{highlightText(name, search)}</p>
            {lastAt ? (
              <time
                dateTime={lastAt.toISOString()}
                className={cn('shrink-0 text-[11px] tabular-nums', hasUnread ? 'font-medium text-primary' : 'text-muted-foreground')}
              >
                {formatRelativeTime(lastAt, locale)}
              </time>
            ) : null}
          </div>
          {preview || hasUnread ? (
            <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
              {preview ? (
                <p className={cn('min-w-0 flex-1 truncate text-xs', hasUnread ? 'text-foreground/80' : 'text-muted-foreground')}>
                  {highlightText(preview.replace(/\s+/g, ' '), search)}
                </p>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              {hasUnread ? (
                <Badge variant="default" className="h-4 min-w-4 shrink-0 px-1 text-[10px] leading-none">
                  {unread > 99 ? '99+' : unread}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
      <button
        type="button"
        title={pinned ? '取消置顶' : '置顶'}
        aria-label={pinned ? '取消置顶' : '置顶'}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onTogglePin(conv.uid);
        }}
        className={cn(
          'm-1 flex size-7 shrink-0 items-center justify-center self-center rounded-md transition-opacity duration-150 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none',
          pinned
            ? 'text-amber-500 opacity-100 hover:bg-accent hover:text-amber-600'
            : 'text-muted-foreground opacity-100 hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      >
        <Pin className={cn('size-3.5', pinned && 'fill-current')} />
      </button>
    </div>
  );
}

export function ConversationList(props: {
  conversations: Conv[];
  filtered: Conv[];
  selectedUid: number | null;
  selfUid: number;
  search: string;
  onSearchChange: (q: string) => void;
  unreadOnly: boolean;
  onUnreadOnlyChange: (v: boolean) => void;
  pinnedUids: number[];
  seen: Set<string>;
  locale: string;
  searchInputRef: Ref<HTMLInputElement>;
  onSelect: (uid: number) => void;
  onTogglePin: (uid: number) => void;
  headerAction?: ReactNode;
}): JSX.Element {
  const {
    conversations,
    filtered,
    selectedUid,
    selfUid,
    search,
    onSearchChange,
    unreadOnly,
    onUnreadOnlyChange,
    pinnedUids,
    seen,
    locale,
    searchInputRef,
    onSelect,
    onTogglePin,
    headerAction,
  } = props;

  const emptyLabel = conversations.length === 0 ? '暂无消息' : '无匹配会话';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background">
      <div className="flex items-center gap-2 border-b p-2.5">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
            <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </span>
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索用户 / 内容…"
            aria-label="搜索会话"
            autoComplete="off"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant={unreadOnly ? 'default' : 'outline'}
          aria-pressed={unreadOnly}
          onClick={() => onUnreadOnlyChange(!unreadOnly)}
          className="shrink-0"
        >
          未读
        </Button>
        {headerAction}
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-3 py-6 text-center">
          <Mail className="size-8 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">{emptyLabel}</p>
          {conversations.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">点右上角「新会话」开始聊天。</p> : null}
        </div>
      ) : (
        <ScrollArea className="flex-1" viewportClassName="p-1">
          <div role="list" aria-label="会话" className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationRow
                key={conv.uid}
                conv={conv}
                selected={selectedUid === conv.uid}
                pinned={pinnedUids.includes(conv.uid)}
                selfUid={selfUid}
                seen={seen}
                search={search}
                locale={locale}
                onSelect={onSelect}
                onTogglePin={onTogglePin}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
