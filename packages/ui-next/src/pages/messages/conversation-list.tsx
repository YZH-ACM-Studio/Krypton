/**
 * Conversation sidebar for /home/messages.
 *
 * Search is the header. Rows are buttons; the parent owns ArrowUp/Down.
 * Pin is a sibling control so it does not nest a button inside the row.
 */

import type { JSX, ReactNode, Ref } from 'react';
import { Mail, Pin } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import { formatRelativeTime, makeInitials } from '@/lib/format';
import { getMessagePreview, lastMessage, objectIdDate } from './parse';
import { isUnseenIncoming } from './seen';
import type { Conv } from './types';
import { dualPaneTw } from './viewport';

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
        <mark key={index} className="rounded-sm bg-brand-soft text-inherit not-italic">
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
        'group flex min-w-0 items-stretch overflow-hidden rounded-lg',
        selected ? 'bg-surface-active' : 'hover:bg-surface-hover',
      )}
    >
      {/* ds-allow DS005: 会话行是双行列表命中区，标准 Button 的固定控件高度装不下头像和截断预览 */}
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(conv.uid)}
        className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Avatar className="size-8 shrink-0">
          {conv.udoc.avatarUrl ? <AvatarImage src={String(conv.udoc.avatarUrl)} alt={name} /> : null}
          <AvatarFallback className="text-2xs">{makeInitials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p className={cn('min-w-0 flex-1 truncate text-sm', hasUnread ? 'font-semibold' : 'font-medium')}>{highlightText(name, search)}</p>
            {lastAt ? (
              <time
                dateTime={lastAt.toISOString()}
                className={cn('shrink-0 text-2xs tabular', hasUnread ? 'font-medium text-brand-fg' : 'text-fg-subtle')}
              >
                {formatRelativeTime(lastAt, locale)}
              </time>
            ) : null}
          </div>
          {preview || hasUnread ? (
            <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
              {preview ? (
                <p className={cn('min-w-0 flex-1 truncate text-xs', hasUnread ? 'text-fg' : 'text-fg-subtle')}>
                  {highlightText(preview.replace(/\s+/g, ' '), search)}
                </p>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              {hasUnread ? <StatusDot tone="brand" /> : null}
              {hasUnread ? (
                <Badge variant="solid" tone="brand" size="sm" className="shrink-0">
                  {unread > 99 ? '99+' : unread}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
      <Button
        type="button"
        variant={pinned ? 'soft' : 'ghost'}
        size="sm"
        iconOnly
        title={pinned ? '取消置顶' : '置顶'}
        aria-label={pinned ? '取消置顶' : '置顶'}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onTogglePin(conv.uid);
        }}
        className={cn(
          'm-1 self-center',
          pinned
            ? 'opacity-100'
            : cn(
                'opacity-100',
                dualPaneTw('opacity-0'),
                dualPaneTw('group-hover:opacity-100'),
                dualPaneTw('group-focus-within:opacity-100'),
                '[@media(hover:none)]:opacity-100',
              ),
        )}
      >
        <Pin className={cn(pinned && 'fill-current')} />
      </Button>
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
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <SearchInput
            ref={searchInputRef}
            size="sm"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索用户 / 内容…"
            aria-label="搜索会话"
            autoComplete="off"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={unreadOnly ? 'soft' : 'secondary'}
            aria-pressed={unreadOnly}
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
            className="shrink-0"
          >
            未读
          </Button>
          {headerAction}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            compact
            icon={<Mail />}
            title={emptyLabel}
            description={conversations.length === 0 ? '点右上角「新会话」开始聊天。' : undefined}
          />
        </div>
      ) : (
        <ScrollArea className="min-h-0 min-w-0 flex-1" viewportLayout="block" viewportClassName="overflow-x-hidden p-1 [&>div]:min-w-0 [&>div]:w-full">
          <div role="list" aria-label="会话" className="flex w-full min-w-0 flex-col overflow-hidden">
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
