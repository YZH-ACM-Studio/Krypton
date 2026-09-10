import { useCallback, useEffect, useRef, type JSX, type MutableRefObject, type ReactNode, type Ref } from 'react';
import { ChevronLeft, Copy, Quote, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';
import { makeInitials, replaceRouteTokens, resolveUiLocale } from '@/lib/format';
import { MessageBody } from './content';
import { objectIdDate } from './parse';
import { isUnseenIncoming } from './seen';
import type { Conv, MessageDoc } from './types';

const MINUTE_MS = 60_000;
const STICK_THRESHOLD_PX = 64;

export function MessageThread(props: {
  conv: Conv | null;
  selfUid: number;
  locale: string;
  userDetailUrl: string;
  seen: Set<string>;
  onQuote: (m: MessageDoc) => void;
  onAskDelete: (m: MessageDoc) => void;
  onCopy: (m: MessageDoc) => void;
  onBack?: () => void;
  stickToBottomRef: MutableRefObject<boolean>;
  viewportRef: Ref<HTMLDivElement>;
  onJumpToLatest: () => void;
  showJump: boolean;
  unreadAnchorId?: string | null;
}): JSX.Element {
  const {
    conv,
    selfUid,
    locale,
    userDetailUrl,
    seen,
    onQuote,
    onAskDelete,
    onCopy,
    onBack,
    stickToBottomRef,
    viewportRef,
    onJumpToLatest,
    showJump,
    unreadAnchorId = null,
  } = props;

  const detachViewportRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      detachViewportRef.current?.();
      detachViewportRef.current = null;
    },
    [],
  );

  const setViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      detachViewportRef.current?.();
      detachViewportRef.current = null;
      assignRef(viewportRef, node);
      if (!node) return;
      const syncStick = () => {
        stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= STICK_THRESHOLD_PX;
      };
      syncStick();
      node.addEventListener('scroll', syncStick, { passive: true });
      detachViewportRef.current = () => node.removeEventListener('scroll', syncStick);
    },
    [stickToBottomRef, viewportRef],
  );

  if (!conv) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">选择一个会话</p>
      </div>
    );
  }

  const displayName = conv.udoc.uname || `UID ${conv.uid}`;
  const profileHref = resolveProfileHref(userDetailUrl, conv.uid);
  const firstUnreadIndex = unreadAnchorId
    ? conv.messages.findIndex((message) => String(message._id) === unreadAnchorId)
    : conv.messages.findIndex((message) => isUnseenIncoming(message, selfUid, seen));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <Button type="button" variant="ghost" size="sm" name="返回" onClick={onBack} className="h-8 shrink-0 px-2">
              <ChevronLeft className="size-4" aria-hidden="true" />
              返回
            </Button>
          ) : null}
          <Avatar className="size-7 shrink-0">
            {conv.udoc.avatarUrl ? <AvatarImage src={String(conv.udoc.avatarUrl)} alt={displayName} /> : null}
            <AvatarFallback className="text-[10px]">{makeInitials(displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="text-[10px] text-muted-foreground">{conv.messages.length} 条消息</p>
          </div>
        </div>
        <a
          href={profileHref}
          className="shrink-0 rounded-sm text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          资料
        </a>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1" viewportRef={setViewportRef} viewportClassName="space-y-2 p-4">
          {conv.messages.map((message, index) => {
            const fromMe = message.from === selfUid;
            const time = objectIdDate(message._id);
            const prevTime = index > 0 ? objectIdDate(conv.messages[index - 1]._id) : null;
            const showDate = Boolean(time && (!prevTime || !sameCalendarDay(time, prevTime)));
            const showTime = !prevTime || Boolean(time && prevTime && Math.abs(time.getTime() - prevTime.getTime()) > MINUTE_MS);
            return (
              <div key={String(message._id) || index} className="space-y-1">
                {showDate && time ? (
                  <p className="my-2 text-center text-[11px] text-muted-foreground">{formatDateSeparator(time, locale)}</p>
                ) : null}
                {index === firstUnreadIndex ? (
                  <div className="my-2 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[10px] font-medium text-destructive">未读消息</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                {showTime && time ? (
                  <p className="my-1 text-center text-[10px] text-muted-foreground/70">{formatClock(time, locale)}</p>
                ) : null}
                <div className={cn('group flex items-center gap-1.5', fromMe ? 'justify-end' : 'justify-start')}>
                  {fromMe ? (
                    <MessageActions message={message} fromMe onQuote={onQuote} onCopy={onCopy} onAskDelete={onAskDelete} />
                  ) : null}
                  <div
                    className={cn(
                      'max-w-[75%] break-words rounded-2xl px-3 py-2 text-sm leading-6',
                      fromMe ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted',
                    )}
                  >
                    <MessageBody message={message} fromMe={fromMe} />
                  </div>
                  {!fromMe ? (
                    <MessageActions message={message} fromMe={false} onQuote={onQuote} onCopy={onCopy} onAskDelete={onAskDelete} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </ScrollArea>
        {showJump ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <Button type="button" size="sm" variant="secondary" className="pointer-events-auto shadow-sm" onClick={onJumpToLatest}>
              有新消息
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageActions(props: {
  message: MessageDoc;
  fromMe: boolean;
  onQuote: (m: MessageDoc) => void;
  onCopy: (m: MessageDoc) => void;
  onAskDelete: (m: MessageDoc) => void;
}): JSX.Element {
  const { message, fromMe, onQuote, onCopy, onAskDelete } = props;
  return (
    <div className="flex flex-col gap-0.5 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
      <ThreadIconButton title="引用" onClick={() => onQuote(message)}>
        <Quote className="size-3" aria-hidden="true" />
      </ThreadIconButton>
      <ThreadIconButton title="复制" onClick={() => onCopy(message)}>
        <Copy className="size-3" aria-hidden="true" />
      </ThreadIconButton>
      {fromMe ? (
        <ThreadIconButton title="删除" destructive onClick={() => onAskDelete(message)}>
          <Trash2 className="size-3" aria-hidden="true" />
        </ThreadIconButton>
      ) : null}
    </div>
  );
}

function ThreadIconButton(props: {
  title: string;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
}): JSX.Element {
  const { title, onClick, destructive, children } = props;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'rounded p-0.5 text-muted-foreground transition-colors duration-150 motion-reduce:transition-none',
        'hover:bg-accent hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        destructive && 'hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      {children}
    </button>
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  ref.current = value;
}

function resolveProfileHref(userDetailUrl: string, uid: number): string {
  if (userDetailUrl.includes('__UID__')) {
    return replaceRouteTokens(userDetailUrl, { UID: uid });
  }
  return userDetailUrl;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatClock(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(resolveUiLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateSeparator(date: Date, locale: string): string {
  const now = new Date();
  if (sameCalendarDay(date, now)) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameCalendarDay(date, yesterday)) return '昨天';
  return new Intl.DateTimeFormat(resolveUiLocale(locale), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
