/**
 * /home/messages workbench — list + thread + composer wiring.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { ConversationList } from './conversation-list';
import { MessageThread } from './thread';
import { MessageComposer } from './composer';
import { NewConversation } from './new-conversation';
import { createPendingConv, getMessagePreview, mergeConversations, parseConversations, sortConversations, upsertConversation } from './parse';
import { readMessageTarget, writeMessageTarget } from './url';
import { clearDraft, loadDraft, saveDraft } from './drafts';
import { loadPins, togglePin } from './pins';
import { isUnseenIncoming, loadSeen, markConvSeen } from './seen';
import type { Conv, MessageDoc } from './types';

const POLL_MS = 15_000;
const NARROW_QUERY = '(max-width: 767px)';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMessagesFromPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined;
  return payload.messages;
}

function matchesSearch(conv: Conv, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if ((conv.udoc.uname || '').toLowerCase().includes(needle)) return true;
  if (`uid ${conv.uid}`.includes(needle) || String(conv.uid).includes(needle)) return true;
  return conv.messages.some((message) => {
    if (
      String(message.content || '')
        .toLowerCase()
        .includes(needle)
    ) {
      return true;
    }
    return getMessagePreview(message).toLowerCase().includes(needle);
  });
}

function hasUnseenIncoming(conv: Conv, selfUid: number, seen: Set<string>): boolean {
  return conv.messages.some((message) => isUnseenIncoming(message, selfUid, seen));
}

function countNewIncoming(prev: Conv[], next: Conv[], selfUid: number): number {
  const prevIds = new Set<string>();
  for (const conv of prev) {
    for (const message of conv.messages) prevIds.add(String(message._id));
  }
  let count = 0;
  for (const conv of next) {
    for (const message of conv.messages) {
      if (!prevIds.has(String(message._id)) && message.from !== selfUid) count += 1;
    }
  }
  return count;
}

function notifyNewIncoming(count: number): void {
  if (count <= 0) return;
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState !== 'hidden') return;
  void new Notification('Krypton', { body: `${count} 条新消息` });
}

function readNarrowViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

function initMessagesPanel(pageData: unknown, selfUid: number, search: string): { conversations: Conv[]; selectedUid: number | null } {
  const parsed = parseConversations(readMessagesFromPayload(pageData));
  const pinnedUids = loadPins();
  const sorted = sortConversations(parsed, pinnedUids);
  const target = readMessageTarget(search, selfUid);
  if (target == null) {
    return {
      conversations: sorted,
      selectedUid: readNarrowViewport() ? null : sorted[0]?.uid ?? null,
    };
  }
  if (sorted.some((conv) => conv.uid === target)) {
    return { conversations: sorted, selectedUid: target };
  }
  return {
    conversations: sortConversations(upsertConversation(sorted, createPendingConv(target)), pinnedUids),
    selectedUid: target,
  };
}

async function fetchMessageConversations(): Promise<Conv[]> {
  const response = await fetchHydroResponse('/home/messages', { headers: { Accept: 'application/json' }, credentials: 'include' }, '刷新消息失败');
  if (!response.ok) throw new Error(await readHydroResponseError(response, '刷新消息失败'));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    console.error('[messages] Invalid message refresh response', error);
    throw new Error('刷新消息失败', { cause: error });
  }
  return parseConversations(readMessagesFromPayload(payload));
}

export function MessagesPanel(): JSX.Element {
  const bs = useBootstrap();
  const selfUid = bs.user.id;
  const initialRef = useRef<{ conversations: Conv[]; selectedUid: number | null } | null>(null);
  const initial = (initialRef.current ??= initMessagesPanel(bs.page.data, selfUid, typeof window === 'undefined' ? '' : window.location.search));

  const [conversations, setConversations] = useState<Conv[]>(initial.conversations);
  const [selectedUid, setSelectedUid] = useState<number | null>(initial.selectedUid);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pinnedUids, setPinnedUids] = useState<number[]>(() => loadPins());
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen());
  const [draftContent, setDraftContent] = useState(() => (initial.selectedUid != null ? loadDraft(initial.selectedUid) : ''));
  const [pendingDelete, setPendingDelete] = useState<MessageDoc | null>(null);
  const [sending, setSending] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [isNarrow, setIsNarrow] = useState(readNarrowViewport);
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);

  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const conversationsRef = useRef(conversations);
  const selectedUidRef = useRef(selectedUid);
  const draftContentRef = useRef(draftContent);
  const previousSelectedUidRef = useRef<number | null>(selectedUid);
  const sendingRef = useRef(false);
  const pendingDeleteRef = useRef<MessageDoc | null>(null);
  const isNarrowRef = useRef(isNarrow);

  conversationsRef.current = conversations;
  selectedUidRef.current = selectedUid;
  draftContentRef.current = draftContent;
  pendingDeleteRef.current = pendingDelete;
  isNarrowRef.current = isNarrow;

  const orderedConversations = sortConversations(conversations, pinnedUids);
  const filteredConversations = orderedConversations.filter((conv) => {
    if (!matchesSearch(conv, search)) return false;
    if (unreadOnly && !hasUnseenIncoming(conv, selfUid, seen)) return false;
    return true;
  });
  const filteredRef = useRef(filteredConversations);
  filteredRef.current = filteredConversations;

  const activeConv = conversations.find((conv) => conv.uid === selectedUid) ?? null;
  const selectedMessageIds = activeConv ? activeConv.messages.map((message) => String(message._id)).join('\0') : '';

  useEffect(() => {
    writeMessageTarget(selectedUid);
  }, [selectedUid]);

  useEffect(() => {
    const previousUid = previousSelectedUidRef.current;
    if (previousUid != null && previousUid !== selectedUid) {
      saveDraft(previousUid, draftContentRef.current);
    }
    previousSelectedUidRef.current = selectedUid;
    const nextDraft = selectedUid != null ? loadDraft(selectedUid) : '';
    draftContentRef.current = nextDraft;
    setDraftContent(nextDraft);
    stickToBottomRef.current = true;
    setShowJump(false);
    const opened = conversationsRef.current.find((conv) => conv.uid === selectedUid);
    const firstUnseen = opened?.messages.find((message) => isUnseenIncoming(message, selfUid, loadSeen()));
    setUnreadAnchorId(firstUnseen ? String(firstUnseen._id) : null);
  }, [selectedUid, selfUid]);

  useEffect(() => {
    const conv = conversationsRef.current.find((item) => item.uid === selectedUid);
    if (!conv || conv.messages.length === 0) return;
    const ids = conv.messages.map((message) => String(message._id));
    setSeen((current) => {
      if (ids.every((id) => current.has(id))) return current;
      return markConvSeen(ids);
    });
  }, [selectedUid, selectedMessageIds]);

  useEffect(() => {
    if (selectedUid == null) return;
    if (!stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
      stickToBottomRef.current = true;
      setShowJump(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedUid, selectedMessageIds]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const sync = () => setIsNarrow(mq.matches);
    sync();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    void Notification.requestPermission().catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const fresh = await fetchMessageConversations();
        if (cancelled) return;
        setRefreshError('');
        const prev = conversationsRef.current;
        const incoming = countNewIncoming(prev, fresh, selfUid);
        const merged = mergeConversations(prev, fresh);
        conversationsRef.current = merged;
        setConversations(merged);
        notifyNewIncoming(incoming);
        const selected = selectedUidRef.current;
        if (selected == null) return;
        const prevConv = prev.find((conv) => conv.uid === selected);
        const nextConv = merged.find((conv) => conv.uid === selected);
        const prevCount = prevConv?.messages.length ?? 0;
        const nextCount = nextConv?.messages.length ?? 0;
        if (nextCount > prevCount && !stickToBottomRef.current) {
          setShowJump(true);
          return;
        }
        if (stickToBottomRef.current) {
          window.requestAnimationFrame(() => {
            const viewport = viewportRef.current;
            if (!viewport) return;
            viewport.scrollTop = viewport.scrollHeight;
          });
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[messages] Message refresh failed', error);
        setRefreshError(error instanceof Error && error.message ? error.message : '刷新消息失败');
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selfUid]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'));
      const searchEl = searchInputRef.current;
      const inSearch = Boolean(searchEl && target instanceof Node && (target === searchEl || searchEl.contains(target)));

      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !inField) {
        event.preventDefault();
        searchEl?.focus();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !inField) {
        event.preventDefault();
        searchEl?.focus();
        return;
      }
      if (pendingDeleteRef.current || inField) return;
      if (event.key === 'Escape' && isNarrowRef.current && selectedUidRef.current != null && !inField) {
        event.preventDefault();
        setSelectedUid(null);
        return;
      }
      if (inSearch) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const list = filteredRef.current;
      if (list.length === 0) return;
      event.preventDefault();
      const currentUid = selectedUidRef.current;
      const index = list.findIndex((conv) => conv.uid === currentUid);
      if (event.key === 'ArrowDown') {
        const next = index < 0 ? list[0] : list[Math.min(list.length - 1, index + 1)];
        if (next) setSelectedUid(next.uid);
        return;
      }
      const next = index < 0 ? list[list.length - 1] : list[Math.max(0, index - 1)];
      if (next) setSelectedUid(next.uid);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(
    () => () => {
      const uid = selectedUidRef.current;
      if (uid != null) saveDraft(uid, draftContentRef.current);
    },
    [],
  );

  const handleDraftChange = (value: string) => {
    draftContentRef.current = value;
    setDraftContent(value);
    if (selectedUid != null) saveDraft(selectedUid, value);
  };

  const insertQuote = (message: MessageDoc) => {
    if (!activeConv) return;
    const uname = activeConv.udoc.uname || `UID ${activeConv.uid}`;
    const body = getMessagePreview(message)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const quote = `> @${uname} 写道：\n${body}\n\n`;
    setDraftContent((current) => {
      const next = current + (current && !current.endsWith('\n') ? '\n' : '') + quote;
      draftContentRef.current = next;
      saveDraft(activeConv.uid, next);
      return next;
    });
    requestAnimationFrame(() => draftRef.current?.focus());
  };

  const copyMessage = async (message: MessageDoc) => {
    const text = getMessagePreview(message);
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      setMessageError('当前环境不支持复制');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setMessageError('');
    } catch (error) {
      console.error('[messages] Copy message failed', error);
      setMessageError('复制消息失败，请手动选择文本后再试。');
    }
  };

  const sendMessage = async () => {
    if (!activeConv || sendingRef.current) return;
    const content = draftContentRef.current;
    if (!content.trim()) return;
    sendingRef.current = true;
    setSending(true);
    setMessageError('');
    const fallback = '发送消息失败';
    try {
      const form = new FormData();
      form.append('operation', 'send');
      form.append('uid', String(activeConv.uid));
      form.append('content', content);
      const response = await fetchHydroResponse(
        '/home/messages',
        {
          method: 'POST',
          body: form,
          credentials: 'include',
          headers: { Accept: 'application/json' },
        },
        fallback,
      );
      if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
      clearDraft(activeConv.uid);
      draftContentRef.current = '';
      setDraftContent('');
      try {
        const fresh = await fetchMessageConversations();
        const merged = mergeConversations(conversationsRef.current, fresh);
        conversationsRef.current = merged;
        setConversations(merged);
        setRefreshError('');
        stickToBottomRef.current = true;
        setShowJump(false);
        window.requestAnimationFrame(() => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          viewport.scrollTop = viewport.scrollHeight;
        });
      } catch (error) {
        console.error('[messages] Message refresh after send failed', error);
        setRefreshError(error instanceof Error && error.message ? error.message : '刷新消息失败');
      }
    } catch (error) {
      setMessageError(error instanceof Error && error.message ? error.message : fallback);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const confirmDelete = async (msg: MessageDoc) => {
    setPendingDelete(null);
    if (!msg._id) return;
    setMessageError('');
    const form = new FormData();
    form.append('operation', 'delete_message');
    form.append('messageId', String(msg._id));
    try {
      const response = await fetchHydroResponse(
        '/home/messages',
        {
          method: 'POST',
          body: form,
          credentials: 'include',
          headers: { Accept: 'application/json' },
        },
        '删除消息失败',
      );
      if (!response.ok) throw new Error(await readHydroResponseError(response, '删除消息失败'));
      const keepUid = selectedUidRef.current;
      setConversations((current) => {
        const next = current.map((conv) => ({
          ...conv,
          messages: conv.messages.filter((item) => String(item._id) !== String(msg._id)),
        }));
        const filtered = next.filter((conv) => conv.messages.length > 0 || conv.uid === keepUid);
        conversationsRef.current = filtered;
        return filtered;
      });
    } catch (error) {
      setMessageError(error instanceof Error && error.message ? error.message : '删除消息失败');
    }
  };

  const handlePickUser = (user: { _id: number; uname?: string; avatarUrl?: string }) => {
    if (user._id === selfUid) return;
    setConversations((prev) => {
      if (prev.some((conv) => conv.uid === user._id)) return prev;
      const next = upsertConversation(prev, createPendingConv(user._id, user));
      conversationsRef.current = next;
      return next;
    });
    setSelectedUid(user._id);
  };

  const jumpToLatest = () => {
    stickToBottomRef.current = true;
    setShowJump(false);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  };

  const errorText = messageError || refreshError;
  const showList = selectedUid == null;
  const showThread = selectedUid != null;

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[480px] flex-col overflow-hidden rounded-xl border bg-background">
      {errorText ? (
        <p role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {errorText}
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(260px,320px)_1fr]">
        <section className={cn('h-full min-h-0 flex-col', showThread ? 'hidden md:flex' : 'flex')}>
          <ConversationList
            conversations={orderedConversations}
            filtered={filteredConversations}
            selectedUid={selectedUid}
            selfUid={selfUid}
            search={search}
            onSearchChange={setSearch}
            unreadOnly={unreadOnly}
            onUnreadOnlyChange={setUnreadOnly}
            pinnedUids={pinnedUids}
            seen={seen}
            locale={bs.locale}
            searchInputRef={searchInputRef}
            onSelect={setSelectedUid}
            onTogglePin={(uid) => setPinnedUids(togglePin(uid))}
            headerAction={<NewConversation domainId={bs.domain.id} selfUid={selfUid} onPick={handlePickUser} />}
          />
        </section>
        <section className={cn('h-full min-h-0 flex-col', showList ? 'hidden md:flex' : 'flex')}>
          <MessageThread
            conv={activeConv}
            selfUid={selfUid}
            locale={bs.locale}
            userDetailUrl={bs.urls.userDetail}
            seen={seen}
            onQuote={insertQuote}
            onAskDelete={setPendingDelete}
            onCopy={(message) => {
              void copyMessage(message);
            }}
            onBack={isNarrow ? () => setSelectedUid(null) : undefined}
            stickToBottomRef={stickToBottomRef}
            viewportRef={viewportRef}
            onJumpToLatest={jumpToLatest}
            showJump={showJump}
            unreadAnchorId={unreadAnchorId}
          />
          {activeConv ? (
            <MessageComposer
              draftRef={draftRef}
              value={draftContent}
              onChange={handleDraftChange}
              onSend={() => {
                void sendMessage();
              }}
              sending={sending}
            />
          ) : null}
        </section>
      </div>

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="w-full sm:w-[400px]" onClose={() => setPendingDelete(null)}>
          <DialogHeader>
            <DialogTitle>删除消息</DialogTitle>
          </DialogHeader>
          <p className="px-6 pt-4 text-sm text-muted-foreground">此操作无法撤销。该消息将从你和对方的会话中移除。</p>
          <div className="mt-4 flex justify-end gap-2 px-6 pb-6">
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={() => pendingDelete && void confirmDelete(pendingDelete)}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
